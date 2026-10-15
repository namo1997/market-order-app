#!/usr/bin/env python3
"""Verify runtime reflection metadata in actual shrunk APKs (Android dexdump).

Run after assembleDebug/assembleRelease with TMPDIR on the verified SOLAO SSD:
python3 -B tests/verify-apk-metadata.py --dexdump "$ANDROID_HOME/build-tools/36.0.0/dexdump" APK [APK ...]
No device, credentials, signing keys, or third party Python packages required.
"""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import zipfile

CORE = "Lcom/getcapacitor/"
ANNOTATION = CORE + "annotation/"
TARGETS = {
    "com.capacitorjs.plugins.camera.CameraPlugin": ("Camera", ["getPhoto", "pickImages", "requestPermissions", "pickLimitedLibraryPhotos", "getLimitedLibraryPhotos"]),
    "com.capacitorjs.plugins.preferences.PreferencesPlugin": ("Preferences", ["configure", "get", "set", "remove", "clear", "keys", "migrate", "removeOld"]),
    "com.capacitorjs.plugins.network.NetworkPlugin": ("Network", ["getStatus"]),
    "ee.forgr.capacitor.social.login.SocialLoginPlugin": ("SocialLogin", ["initialize", "login", "logout", "getAuthorizationCode", "refresh", "isLoggedIn", "providerSpecificCall", "getPluginVersion"]),
    "th.co.solao.receiving.MainActivity$ReceivingShellPlugin": ("ReceivingShell", ["setTheme", "setBackHandlerReady", "exit"]),
}


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def inspect(apk, dexdump):
    classes, annotations, code = {}, {}, {}
    with zipfile.ZipFile(apk) as archive, tempfile.TemporaryDirectory(prefix="apk-metadata-") as temp:
        registry = json.loads(archive.read("assets/capacitor.plugins.json"))
        require({entry["classpath"] for entry in registry} <= set(TARGETS), "Unreviewed plugin in registry; extend TARGETS")
        require(set(TARGETS) - {"th.co.solao.receiving.MainActivity$ReceivingShellPlugin"} <= {entry["classpath"] for entry in registry}, "Missing registered plugin")
        dex_names = [name for name in archive.namelist() if re.fullmatch(r"classes\d*\.dex", name)]
        require(dex_names, "No DEX files")
        for name in dex_names:
            dex = Path(temp) / name
            dex.write_bytes(archive.read(name))
            output = subprocess.check_output([dexdump, "-a", str(dex)], text=True, errors="replace")
            by_number = {}
            for match in re.finditer(r"Class #(\d+)\s+-\n(.*?)(?=\nClass #|\Z)", output, re.S):
                descriptor = re.search(r"Class descriptor\s+: '([^']+)'", match[2])
                if descriptor:
                    by_number[match[1]] = descriptor[1]
                    classes[descriptor[1]] = match[2]
            for match in re.finditer(r"Class #(\d+) annotations:\n(.*?)(?=\nClass #)", output, re.S):
                annotations[by_number[match[1]]] = match[2]
            disassembly = subprocess.check_output([dexdump, "-d", str(dex)], text=True, errors="replace")
            require(not re.search(r"invoke-.*Landroid/util/Log;\.(?:v|d|i|w|e|wtf|println):", disassembly), "APK still invokes a credential-capable Android Log method")
            for match in re.finditer(r"Class #\d+\s+-\n(.*?)(?=\nClass #|\Z)", disassembly, re.S):
                descriptor = re.search(r"Class descriptor\s+: '([^']+)'", match[1])
                if descriptor:
                    code[descriptor[1]] = match[1]

    checks = []
    for name in ["CapacitorPlugin", "Permission", "PermissionCallback", "ActivityCallback"]:
        descriptor = ANNOTATION + name + ";"
        require(descriptor in classes, f"Missing/renamed annotation type: {name}")
        require("ANNOTATION" in classes[descriptor], f"Not an annotation: {name}")
        require("VISIBILITY_RUNTIME Ljava/lang/annotation/Retention; value=RUNTIME" in annotations.get(descriptor, ""), f"No runtime retention: {name}")
        checks.append(f"{name}: type + RUNTIME retention")
    for name, members in {"CapacitorPlugin": ["name", "permissions", "requestCodes"], "Permission": ["alias", "strings"]}.items():
        descriptor = ANNOTATION + name + ";"
        defaults = annotations.get(descriptor, "")
        require("Ldalvik/annotation/AnnotationDefault;" in defaults, f"Missing annotation defaults: {name}")
        for member in members:
            require(f"name          : '{member}'" in classes[descriptor], f"Missing annotation member {name}.{member}")
            require(re.search(rf"\b{member}=", defaults), f"Missing default {name}.{member}")
        checks.append(f"{name}: all members and defaults")
    method_type = CORE + "PluginMethod;"
    require(method_type in classes, "Missing/renamed PluginMethod annotation")
    require("value=RUNTIME" in annotations.get(method_type, ""), "PluginMethod runtime retention missing")
    require("Ldalvik/annotation/AnnotationDefault;" in annotations.get(method_type, ""), "PluginMethod defaults missing")
    checks.append("PluginMethod: type + runtime retention + defaults")

    for classname, (plugin_name, methods) in TARGETS.items():
        descriptor = "L" + classname.replace(".", "/") + ";"
        require(descriptor in classes, f"Missing plugin class: {classname}")
        metadata = annotations.get(descriptor, "")
        class_metadata = metadata.split("Annotations on method")[0].split("Annotations on field")[0]
        require(f'VISIBILITY_RUNTIME {ANNOTATION}CapacitorPlugin; name="{plugin_name}"' in class_metadata, f"Missing plugin annotation: {classname}")
        for method in methods:
            require(re.search(rf"Annotations on method #\d+ '{method}'\n  VISIBILITY_RUNTIME {re.escape(method_type)}", metadata), f"Missing @PluginMethod: {plugin_name}.{method}")
        checks.append(f"{plugin_name}: class annotation + {len(methods)} PluginMethod entries")
        if plugin_name == "Camera":
            for alias, permission in {"camera": "android.permission.CAMERA", "photos": None, "saveGallery": "android.permission.WRITE_EXTERNAL_STORAGE", "readExternalStorage": "android.permission.READ_EXTERNAL_STORAGE"}.items():
                pattern = rf'{re.escape(ANNOTATION)}Permission; alias="{alias}" strings=\{{([^}}]*)\}}'
                value = re.search(pattern, class_metadata)
                require(value and (permission is None or permission in value[1]), f"Missing nested Camera permission: {alias}")
            for method, annotation in {"cameraPermissionsCallback": "PermissionCallback", "processCameraImage": "ActivityCallback", "processEditedImage": "ActivityCallback"}.items():
                require(re.search(rf"Annotations on method #\d+ '{method}'\n  VISIBILITY_RUNTIME {re.escape(ANNOTATION + annotation + ';')}", metadata), f"Missing camera callback: {method}")
            checks.append("Camera: four nested permissions + permission/activity callbacks")
    # Bridge uses Plugin fields and PluginHandle metadata through reflection.
    for descriptor in [CORE + "Plugin;", CORE + "PluginHandle;", CORE + "Bridge;"]:
        require(descriptor in classes, f"Missing core bridge type: {descriptor}")
    checks.append("Plugin / PluginHandle / Bridge retained")
    handle = classes[CORE + "PluginHandle;"]
    require("name          : 'pluginAnnotation'" in handle and ANNOTATION + "CapacitorPlugin;" in handle, "PluginHandle annotation field removed")
    plugin_code = code[CORE + "Plugin;"]
    permission_code = re.search(r"name          : 'getPermissionStates'.*?(?=    #\d+|  SourceFile|\Z)", plugin_code, re.S)
    require(permission_code and not re.search(r"const/4[^\n]*#int 0[^\n]*\n[^\n]*throw", permission_code[0]), "getPermissionStates replaced with throw-null (r5 regression)")
    require(ANNOTATION + "CapacitorPlugin;.permissions:" in code[CORE + "Bridge;"], "Bridge no longer reads permission annotations")
    checks.append("Permission state path: annotation field and read retained; no throw-null stub")
    checks.append("All DEX: zero calls to Android Log v/d/i/w/e/wtf/println")
    return {"apk": str(apk), "checks": checks, "tests": len(checks), "pass": len(checks), "fail": 0, "skip": 0}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dexdump", required=True)
    parser.add_argument("apk", nargs="+")
    args = parser.parse_args()
    scratch = Path(os.environ.get("TMPDIR", "")).resolve()
    require(scratch.is_relative_to(Path("/Volumes/SSD Files/SOLAO/market-order-system")), "TMPDIR must be on the verified SOLAO SSD")
    for apk in args.apk:
        print(json.dumps(inspect(Path(apk), args.dexdump), ensure_ascii=False))


if __name__ == "__main__":
    main()

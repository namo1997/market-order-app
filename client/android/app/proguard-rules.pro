# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile
# Capacitor 7.4.3 consumer rules keep plugin classes/methods, but R8 full mode
# can still discard their annotation types and annotation default values.
# Bridge.getPermissionStates() reads these at runtime, including nested
# @Permission aliases. Preserve core metadata and all reflective entry points.
# allowoptimization keeps Log stripping active in the retained core classes.
-keepattributes *Annotation*,AnnotationDefault
-keep,allowoptimization class com.getcapacitor.** { *; }
-keep,allowoptimization @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keepclassmembers,allowoptimization class * {
    @com.getcapacitor.PluginMethod <methods>;
    @com.getcapacitor.annotation.PermissionCallback <methods>;
    @com.getcapacitor.annotation.ActivityCallback <methods>;
}

# Google auth dependencies must never emit credential objects into Logcat.
# Facebook is disabled in SocialLogin config and its SDK is compileOnly; these
# unreachable optional references are intentionally absent from the APK.
-dontwarn com.facebook.**
-assumenosideeffects class android.util.Log {
    public static *** v(...);
    public static *** d(...);
    public static *** i(...);
    public static *** w(...);
    public static *** e(...);
    public static *** wtf(...);
    public static *** println(...);
}

# DocumentScanner is registered by class name; preserve bridge and ML Kit API
# metadata under R8, alongside the Capacitor annotation rules above (8115a1e).
-keep,allowoptimization class io.capawesome.capacitorjs.plugins.mlkit.documentscanner.** { *; }
-keep,allowoptimization class com.google.mlkit.vision.documentscanner.** { *; }

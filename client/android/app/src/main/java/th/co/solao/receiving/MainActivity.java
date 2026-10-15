package th.co.solao.receiving;

import android.os.Bundle;
import android.os.Build;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.view.ViewGroup;
import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AlertDialog;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.graphics.Insets;
import androidx.core.splashscreen.SplashScreen;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import android.content.Intent;
import com.getcapacitor.PluginHandle;
import ee.forgr.capacitor.social.login.GoogleProvider;
import ee.forgr.capacitor.social.login.SocialLoginPlugin;
import ee.forgr.capacitor.social.login.ModifiedMainActivityForSocialLoginPlugin;

public class MainActivity extends BridgeActivity implements ModifiedMainActivityForSocialLoginPlugin {
    private boolean shellReady = false;
    private boolean backPromptVisible = false;
    private Boolean selectedDark = null;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Apply the same navy/gold launch screen on Android 6–11 and Android 12+.
        SplashScreen.installSplashScreen(this);
        registerPlugin(ReceivingShellPlugin.class);
        super.onCreate(savedInstanceState);
        installSystemInsets();
        applySystemTheme(isDark());
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (shellReady && getBridge() != null) {
                    getBridge().triggerWindowJSEvent("receivingBack");
                } else if (!backPromptVisible) {
                    // Fail closed while the web shell is loading or unavailable.
                    backPromptVisible = true;
                    new AlertDialog.Builder(MainActivity.this)
                        .setTitle("ออกจากแอปหรือไม่")
                        .setMessage("ข้อมูลที่ยังไม่ส่งอาจหายเมื่อออกจากแอป")
                        .setNegativeButton("อยู่ต่อ", (dialog, which) -> {})
                        .setPositiveButton("ทิ้งและออก", (dialog, which) -> finish())
                        .setOnDismissListener(dialog -> backPromptVisible = false)
                        .show();
                }
            }
        });
    }

    private boolean isDark() {
        return selectedDark != null ? selectedDark :
            (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
    }

    private void installSystemInsets() {
        if (Build.VERSION.SDK_INT < 35 || getBridge() == null) return;
        // API 35+ is edge-to-edge. Keep one inset owner and request fresh values
        // after screen/density changes instead of retaining stale WebView margins.
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        ViewCompat.setOnApplyWindowInsetsListener(getBridge().getWebView(), (view, windowInsets) -> {
            Insets bars = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            ViewGroup.MarginLayoutParams layout = (ViewGroup.MarginLayoutParams) view.getLayoutParams();
            if (layout.leftMargin != bars.left || layout.topMargin != bars.top ||
                    layout.rightMargin != bars.right || layout.bottomMargin != bars.bottom) {
                layout.setMargins(bars.left, bars.top, bars.right, bars.bottom);
                view.setLayoutParams(layout);
            }
            return WindowInsetsCompat.CONSUMED;
        });
        getBridge().getWebView().post(() -> ViewCompat.requestApplyInsets(getBridge().getWebView()));
    }

    @Override
    public void onConfigurationChanged(Configuration configuration) {
        super.onConfigurationChanged(configuration);
        installSystemInsets();
        applySystemTheme(isDark());
    }

    @SuppressWarnings("deprecation")
    private void applySystemTheme(boolean dark) {
        int background = Color.parseColor(dark ? "#101522" : "#F7F5F0");
        // Capacitor 7 consumes system insets as WebView margins on API 35+.
        // Paint the exposed window/content behind transparent system bars too.
        getWindow().setBackgroundDrawable(new ColorDrawable(background));
        findViewById(android.R.id.content).setBackgroundColor(background);
        if (getBridge() != null) getBridge().getWebView().setBackgroundColor(background);
        getWindow().setStatusBarColor(background);
        // Android 6/7 cannot draw dark navigation icons: use a readable navy bar.
        getWindow().setNavigationBarColor(!dark && Build.VERSION.SDK_INT < 26 ? Color.parseColor("#1E3168") : background);
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.setAppearanceLightStatusBars(!dark);
        controller.setAppearanceLightNavigationBars(!dark);
        if (Build.VERSION.SDK_INT >= 29) {
            getWindow().setStatusBarContrastEnforced(false);
            getWindow().setNavigationBarContrastEnforced(false);
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        applySystemTheme(isDark());
    }

    @CapacitorPlugin(name = "ReceivingShell")
    public static class ReceivingShellPlugin extends Plugin {
        @PluginMethod
        public void setTheme(PluginCall call) {
            MainActivity activity = (MainActivity) getActivity();
            boolean dark = call.getBoolean("dark", false);
            activity.runOnUiThread(() -> {
                activity.selectedDark = dark;
                activity.applySystemTheme(dark);
                call.resolve();
            });
        }

        @PluginMethod
        public void setBackHandlerReady(PluginCall call) {
            MainActivity activity = (MainActivity) getActivity();
            activity.runOnUiThread(() -> {
                activity.shellReady = call.getBoolean("ready", false);
                call.resolve();
            });
        }

        @PluginMethod
        public void exit(PluginCall call) {
            getActivity().runOnUiThread(() -> { call.resolve(); getActivity().finish(); });
        }
    }

    @Override
    public void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode >= GoogleProvider.REQUEST_AUTHORIZE_GOOGLE_MIN &&
                requestCode < GoogleProvider.REQUEST_AUTHORIZE_GOOGLE_MAX) {
            PluginHandle handle = getBridge().getPlugin("SocialLogin");
            if (handle != null && handle.getInstance() instanceof SocialLoginPlugin) {
                ((SocialLoginPlugin) handle.getInstance()).handleGoogleLoginIntent(requestCode, data);
            }
        }
    }

    @Override
    public void IHaveModifiedTheMainActivityForTheUseWithSocialLoginPlugin() {}
}

package th.co.solao.receiving;

import android.os.Bundle;
import androidx.core.splashscreen.SplashScreen;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Apply the same navy/gold launch screen on Android 6–11 and Android 12+.
        SplashScreen.installSplashScreen(this);
        super.onCreate(savedInstanceState);
    }
}

package th.co.solao.receiving;

import android.content.Intent;
import androidx.work.WorkManager;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONObject;

@CapacitorPlugin(name = "ReceivingPush")
public final class ReceivingPushPlugin extends Plugin {
    @PluginMethod public void sync(PluginCall call) {
        getContext().getSharedPreferences("receiving.push.control", android.content.Context.MODE_PRIVATE).edit().putBoolean("disabled", false).commit();
        if (PushSession.load(getContext()) != null) {
            ReceivingPushWorker.schedule(getContext()); ReceivingPushWorker.enqueue(getContext(), null, null);
        } else WorkManager.getInstance(getContext()).cancelUniqueWork(ReceivingPushWorker.PERIODIC);
        call.resolve();
    }
    @PluginMethod public void stop(PluginCall call) {
        // Called before the shared session is cleared. Clear local work immediately.
        PushSession session = PushSession.load(getContext());
        getContext().getSharedPreferences("receiving.push.control", android.content.Context.MODE_PRIVATE).edit().putBoolean("disabled", true).commit();
        WorkManager.getInstance(getContext()).cancelUniqueWork(ReceivingPushWorker.PERIODIC);
        getBridge().execute(() -> {
            ReceivingPushWorker.unregister(getContext(), session); call.resolve();
        });
    }
    @PluginMethod public void consumeTap(PluginCall call) {
        Intent intent = getActivity().getIntent();
        JSObject result = new JSObject();
        try {
            if (intent != null && UrgentNotifications.ACTION.equals(intent.getAction())) {
                JSONObject data = new JSONObject(intent.getStringExtra(UrgentNotifications.EXTRA_DATA));
                PushSession session = PushSession.load(getContext());
                if (session != null && session.userId.equals(data.optString("user_id")) && session.origin.equals(data.optString("origin")))
                    result.put("followup_id", data.optString("followup_id"));
                intent.removeExtra(UrgentNotifications.EXTRA_DATA);
            }
        } catch (Exception ignored) { /* unrelated or malformed launch */ }
        call.resolve(result);
    }
}

package th.co.solao.receiving;

import android.Manifest;
import android.os.Build;
import androidx.appcompat.app.AlertDialog;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/** Free app-local Capacitor 7 plugin. No external notification service or SDK. */
@CapacitorPlugin(name = "ReceivingAlerts", permissions = {
    @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
})
public class ReceivingAlertsPlugin extends Plugin {
    @Override
    public void load() { UrgentNotifications.ensureChannel(getContext()); }

    private void permissionResult(PluginCall call) {
        JSObject result = new JSObject();
        result.put("granted", UrgentNotifications.permitted(getContext()));
        call.resolve(result);
    }

    @PluginMethod
    public void ensureAlertPermission(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (Build.VERSION.SDK_INT < 33 || getPermissionState("notifications") == PermissionState.GRANTED ||
                    getPermissionState("notifications") == PermissionState.DENIED) {
                permissionResult(call);
                return;
            }
            new AlertDialog.Builder(getActivity())
                .setTitle("เปิดแจ้งเตือนเรื่องด่วนรับสินค้า")
                .setMessage("ใช้เตือนตามของและของเลยกำหนด เสียงจะดังซ้ำจนแตะหรือกดรับทราบ อนุญาตให้แอปแจ้งเตือนหรือไม่")
                .setPositiveButton("อนุญาต", (dialog, which) -> requestPermissionForAlias("notifications", call, "notificationPermissionResult"))
                .setNegativeButton("ไว้ภายหลัง", (dialog, which) -> permissionResult(call))
                .setOnCancelListener(dialog -> permissionResult(call)).show();
        });
    }

    @PermissionCallback
    private void notificationPermissionResult(PluginCall call) { permissionResult(call); }

    @PluginMethod
    public void notifyUrgent(PluginCall call) {
        Integer id = call.getInt("id");
        String title = call.getString("title", "");
        String body = call.getString("body", "");
        String data = call.getString("data", "{}");
        if (id == null || id <= 0 || title.trim().isEmpty() || title.length() > 160 || body.trim().isEmpty() || body.length() > 1000 || data.length() > 4096) {
            call.reject("ข้อมูลแจ้งเตือนไม่ถูกต้อง", "INVALID_ALERT");
            return;
        }
        try {
            if (!FollowupNotifications.foreground(getContext(), new org.json.JSONObject(data), body))
                UrgentNotifications.post(getContext(), id, title, body, data);
            JSObject result = new JSObject(); result.put("id", id); call.resolve(result);
        } catch (SecurityException error) { call.reject("กรุณาเปิดสิทธิ์แจ้งเตือนในการตั้งค่า Android", "PERMISSION_DENIED"); }
        catch (org.json.JSONException error) { call.reject("ข้อมูลแจ้งเตือนไม่ถูกต้อง", "INVALID_ALERT"); }
        catch (RuntimeException error) { call.reject("ส่งแจ้งเตือนไม่สำเร็จ", "ALERT_FAILED"); }
    }

    @PluginMethod
    public void cancelAlert(PluginCall call) {
        Integer id = call.getInt("id");
        if (id == null || id <= 0) { call.reject("รหัสแจ้งเตือนไม่ถูกต้อง", "INVALID_ALERT"); return; }
        UrgentNotifications.cancel(getContext(), id);
        call.resolve();
    }
}

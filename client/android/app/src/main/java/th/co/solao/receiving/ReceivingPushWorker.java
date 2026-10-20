package th.co.solao.receiving;

import android.content.Context;
import androidx.annotation.NonNull;
import androidx.work.*;
import com.google.android.gms.tasks.Tasks;
import com.google.firebase.FirebaseApp;
import com.google.firebase.messaging.FirebaseMessaging;
import org.json.JSONObject;
import org.json.JSONArray;
import java.net.HttpURLConnection;
import java.net.URL;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.TimeUnit;

/** No bill/token in WorkManager's DB. Bounded HTTPS calls; never follow redirects. */
public final class ReceivingPushWorker extends Worker {
    interface Gateway { JSONObject call(PushSession session, String path, String method, JSONObject body) throws Exception; }
    Gateway http = ReceivingPushWorker::request;
    java.util.function.Supplier<String> registrationToken = () -> firebaseToken(getApplicationContext());
    static final String PERIODIC = "receiving-followups-poll";
    public ReceivingPushWorker(@NonNull Context context, @NonNull WorkerParameters params) { super(context, params); }
    static Constraints network() { return new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build(); }
    static PeriodicWorkRequest periodicRequest() {
        return new PeriodicWorkRequest.Builder(ReceivingPushWorker.class, 15, TimeUnit.MINUTES).setConstraints(network()).build();
    }
    static void schedule(Context context) {
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.KEEP,
            periodicRequest());
    }
    static void enqueue(Context context, String id, String userId) {
        Data data = new Data.Builder().putString("followup_id", id).putString("user_id", userId).build();
        OneTimeWorkRequest.Builder work = new OneTimeWorkRequest.Builder(ReceivingPushWorker.class)
            .setInputData(data).setConstraints(network()).setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS);
        // Pre-Android 12 expedited work requires a foreground service; keyless fallback uses ordinary work there.
        if (android.os.Build.VERSION.SDK_INT >= 31) work.setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST);
        WorkManager.getInstance(context).enqueue(work.build());
    }
    static JSONObject request(PushSession session, String path, String method, JSONObject body) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(session.origin + "/api" + path).openConnection();
        try {
            connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(10000); connection.setReadTimeout(10000);
            connection.setRequestMethod(method); connection.setRequestProperty("Authorization", "Bearer " + session.token);
            if (body != null) {
                connection.setDoOutput(true); connection.setRequestProperty("Content-Type", "application/json");
                try (java.io.OutputStream out = connection.getOutputStream()) { out.write(body.toString().getBytes(StandardCharsets.UTF_8)); }
            }
            int status = connection.getResponseCode();
            if (status == 401 || status == 403) throw new AccessDenied();
            if (status == 404) return null;
            if (status < 200 || status >= 300) throw new java.io.IOException("Deferred");
            try (InputStream in = connection.getInputStream(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[4096]; int count;
                while ((count = in.read(buffer)) != -1) {
                    if (out.size() + count > 1048576) throw new java.io.IOException("Response too large");
                    out.write(buffer, 0, count);
                }
                JSONObject envelope = new JSONObject(out.toString("UTF-8"));
                if (!envelope.optBoolean("success")) throw new java.io.IOException("Deferred");
                return envelope.getJSONObject("data");
            }
        } finally { connection.disconnect(); }
    }
    static final class AccessDenied extends Exception {}
    static String firebaseToken(Context context) {
        try {
            if (FirebaseApp.getApps(context).isEmpty() && FirebaseApp.initializeApp(context) == null) return null;
            return Tasks.await(FirebaseMessaging.getInstance().getToken(), 10, TimeUnit.SECONDS);
        } catch (Exception ignored) { return null; }
    }
    static void unregister(Context context, PushSession session) {
        String token = firebaseToken(context);
        if (session != null && token != null) try {
            request(session, "/receiving-push/devices", "DELETE", new JSONObject().put("token", token));
        } catch (Exception ignored) { /* bounded best effort; the receiver also checks its session */ }
        if (!FirebaseApp.getApps(context).isEmpty()) FirebaseMessaging.getInstance().deleteToken();
    }
    private void show(PushSession session, JSONObject row) {
        if (row == null || row.optInt("branch_id", 0) != session.branchId || !"open".equals(row.optString("status"))) return;
        int id = row.optInt("id", 0);
        FollowupNotifications.deliver(getApplicationContext(), session, id, "มีรายการยังไม่ส่ง กรุณาแตะเพื่อตรวจเรื่องตามของ");
    }
    @NonNull @Override public Result doWork() {
        Context context = getApplicationContext();
        PushSession session = PushSession.load(context);
        if (session == null) return Result.success();
        try {
            String id = getInputData().getString("followup_id");
            if (id != null) {
                if (session.userId.equals(getInputData().getString("user_id")) && id.matches("[1-9][0-9]{0,8}"))
                    show(session, http.call(session, "/receiving-push/followups/" + id, "GET", null));
                return Result.success();
            }
            boolean registered = false;
            try {
                JSONObject capabilities = http.call(session, "/receiving-push/capabilities", "GET", null);
                if (capabilities != null && capabilities.optBoolean("fcm")) {
                    String token = registrationToken.get();
                    if (token != null && session.current(context)) {
                        JSONObject response = http.call(session, "/receiving-push/devices", "POST", new JSONObject().put("token", token));
                        registered = response != null && response.optBoolean("registered");
                    }
                }
            } catch (AccessDenied denied) { throw denied; }
            catch (Exception ignored) { /* FCM unavailable: use free polling below. */ }
            if (!registered) {
                JSONObject inbox = http.call(session, "/receiving-followups?status=open", "GET", null);
                if (inbox != null) {
                    JSONArray items = inbox.getJSONArray("items");
                    for (int i = 0; i < Math.min(200, items.length()); i++) show(session, items.getJSONObject(i));
                }
            }
            return Result.success();
        } catch (AccessDenied ignored) { return Result.success(); }
        catch (Exception ignored) { return getRunAttemptCount() < 2 ? Result.retry() : Result.failure(); }
    }
}

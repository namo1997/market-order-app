package th.co.solao.receiving;

import static org.junit.Assert.*;
import static org.robolectric.Shadows.shadowOf;
import android.Manifest;
import android.app.Application;
import android.app.Notification;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import androidx.work.Data;
import androidx.work.ListenableWorker;
import androidx.work.testing.TestWorkerBuilder;
import org.json.JSONObject;
import org.json.JSONArray;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;
import java.util.ArrayList;
import java.util.List;

@RunWith(RobolectricTestRunner.class) @Config(sdk = 33)
public class ReceivingPushTest {
    Context context; NotificationManager manager;
    @Before public void setup() throws Exception {
        context = RuntimeEnvironment.getApplication(); manager = context.getSystemService(NotificationManager.class);
        shadowOf((Application) context).grantPermissions(Manifest.permission.POST_NOTIFICATIONS);
        context.getSharedPreferences("receiving.push.control", 0).edit().clear().commit();
        context.getSharedPreferences("receiving.push.seen", 0).edit().clear().commit();
        session("accounting", "7", "https://example.invalid"); UrgentNotifications.ensureChannel(context);
    }
    void session(String role, String id, String origin) throws Exception {
        JSONObject user = new JSONObject().put("id", id).put("role", role).put("branch_id", 1);
        JSONObject saved = new JSONObject().put("origin", origin).put("token", "synthetic-session").put("user", user);
        context.getSharedPreferences("CapacitorStorage", 0).edit().putString("receiving.session.v1", saved.toString()).commit();
    }
    ReceivingPushWorker worker(Data data) {
        return TestWorkerBuilder.from(context, ReceivingPushWorker.class, Runnable::run).setInputData(data).build();
    }
    JSONObject row(int id, String status) throws Exception { return new JSONObject().put("id", id).put("status", status).put("branch_id", 1); }
    @Test public void noConfigPollsOpenEndpointAndDeduplicatesAcrossRestartsForegroundAndPush() throws Exception {
        List<String> paths = new ArrayList<>();
        ReceivingPushWorker.Gateway gateway = (s, path, method, body) -> {
            paths.add(path);
            return path.contains("capabilities") ? new JSONObject().put("fcm", false) :
                new JSONObject().put("items", new JSONArray().put(row(9, "open")).put(row(10, "resolved")).put(row(11, "open").put("branch_id", 2)));
        };
        ReceivingPushWorker first = worker(Data.EMPTY); first.http = gateway;
        assertEquals(ListenableWorker.Result.success(), first.doWork());
        assertEquals(1, manager.getActiveNotifications().length);
        assertTrue(paths.contains("/receiving-followups?status=open"));
        UrgentNotifications.cancel(context, 9);
        ReceivingPushWorker second = worker(Data.EMPTY); second.http = gateway; second.doWork();
        assertEquals(0, manager.getActiveNotifications().length);
        assertTrue(FollowupNotifications.foreground(context, new JSONObject().put("kind", "followup").put("followup_ids", new JSONArray().put("9")), "ตามของ"));
        assertEquals(0, manager.getActiveNotifications().length);
    }
    @Test public void configuredFcmRegistersAndDoesNotPollButRegistrationFailureFallsBack() throws Exception {
        List<String> methods = new ArrayList<>();
        ReceivingPushWorker first = worker(Data.EMPTY); first.registrationToken = () -> "synthetic-device";
        first.http = (s, path, method, body) -> {
            methods.add(method + " " + path);
            if (path.endsWith("capabilities")) return new JSONObject().put("fcm", true);
            assertEquals("synthetic-device", body.getString("token")); return new JSONObject().put("registered", true);
        };
        assertEquals(ListenableWorker.Result.success(), first.doWork()); assertEquals(2, methods.size());
        assertEquals("POST /receiving-push/devices", methods.get(1));
        first.http = (s, path, method, body) -> {
            if (path.endsWith("capabilities")) return new JSONObject().put("fcm", true);
            if (method.equals("POST")) throw new java.io.IOException("synthetic outage");
            return new JSONObject().put("items", new JSONArray().put(row(12, "open")));
        };
        assertEquals(ListenableWorker.Result.success(), first.doWork()); assertEquals(12, manager.getActiveNotifications()[0].getId());
    }
    @Test public void pushRevalidatesIssueWithAuthAndTapCarriesExactIssueUsingExistingUrgentSound() throws Exception {
        ReceivingPushWorker push = worker(new Data.Builder().putString("followup_id", "17").putString("user_id", "7").build());
        push.http = (s, path, method, body) -> { assertEquals("/receiving-push/followups/17", path); assertEquals("7", s.userId); return row(17, "open"); };
        assertEquals(ListenableWorker.Result.success(), push.doWork());
        Notification n = manager.getActiveNotifications()[0].getNotification();
        assertEquals(UrgentNotifications.CHANNEL_ID, n.getChannelId()); assertTrue((n.flags & Notification.FLAG_INSISTENT) != 0);
        Intent tap = shadowOf(n.contentIntent).getSavedIntent(); JSONObject data = new JSONObject(tap.getStringExtra(UrgentNotifications.EXTRA_DATA));
        assertEquals("17", data.getString("followup_id")); assertEquals("7", data.getString("user_id"));
        assertEquals("https://example.invalid", data.getString("origin"));
        UrgentNotifications.acknowledge(context, tap); assertEquals(0, manager.getActiveNotifications().length);
        push.doWork(); assertEquals(0, manager.getActiveNotifications().length);
    }
    @Test public void oldUserLogoutStaffInsecureOriginAndDeniedSessionNeverNotify() throws Exception {
        ReceivingPushWorker push = worker(new Data.Builder().putString("followup_id", "17").putString("user_id", "8").build());
        push.http = (s,p,m,b) -> { throw new AssertionError("must not request for another user"); };
        push.doWork(); assertEquals(0, manager.getActiveNotifications().length);
        for (String role : new String[] {"user", "unknown"}) { session(role, "7", "https://example.invalid"); assertNull(PushSession.load(context)); push.doWork(); }
        session("accounting", "7", "http://example.invalid"); assertNull(PushSession.load(context));
        session("accounting", "7", "https://example.invalid");
        PushSession previous = PushSession.load(context); context.getSharedPreferences("CapacitorStorage", 0).edit().clear().commit();
        assertFalse(FollowupNotifications.deliver(context, previous, 18, "ตามของ"));
        session("accounting", "7", "https://example.invalid");
        ReceivingPushWorker denied = worker(Data.EMPTY); denied.http = (s,p,m,b) -> { throw new ReceivingPushWorker.AccessDenied(); };
        assertEquals(ListenableWorker.Result.success(), denied.doWork()); assertEquals(0, manager.getActiveNotifications().length);
    }
    @Test public void deniedNotificationPermissionDoesNotConsumeDedupeReservation() {
        shadowOf((Application) context).denyPermissions(Manifest.permission.POST_NOTIFICATIONS);
        assertFalse(FollowupNotifications.deliver(context, PushSession.load(context), 20, "ตามของ"));
        shadowOf((Application) context).grantPermissions(Manifest.permission.POST_NOTIFICATIONS);
        assertTrue(FollowupNotifications.deliver(context, PushSession.load(context), 20, "ตามของ"));
        assertFalse(FollowupNotifications.deliver(context, PushSession.load(context), 20, "ตามของ"));
    }
    @Test public void sessionChangingDuringNetworkRequestPreventsLateNotification() throws Exception {
        ReceivingPushWorker poll = worker(Data.EMPTY);
        poll.http = (s,path,m,b) -> {
            if (path.endsWith("capabilities")) return null;
            session("accounting", "8", "https://example.invalid");
            return new JSONObject().put("items", new JSONArray().put(row(21, "open")));
        };
        assertEquals(ListenableWorker.Result.success(), poll.doWork()); assertEquals(0, manager.getActiveNotifications().length);
    }
    @Test public void periodicFallbackHasFifteenMinuteIntervalNetworkConstraintAndNoCredentialsInInput() {
        androidx.work.PeriodicWorkRequest request = ReceivingPushWorker.periodicRequest();
        assertEquals(900000L, request.getWorkSpec().intervalDuration);
        assertEquals(androidx.work.NetworkType.CONNECTED, request.getWorkSpec().constraints.getRequiredNetworkType());
        assertTrue(request.getWorkSpec().input.getKeyValueMap().isEmpty());
    }
    @Test public void networkErrorsHaveBoundedRetriesAndLogoutControlDisablesEvenAnExistingSession() throws Exception {
        ReceivingPushWorker first = worker(Data.EMPTY); first.http = (s,p,m,b) -> { throw new java.io.IOException("mock offline"); };
        assertEquals(ListenableWorker.Result.retry(), first.doWork());
        ReceivingPushWorker last = TestWorkerBuilder.from(context, ReceivingPushWorker.class, (java.util.concurrent.Executor) Runnable::run)
            .setRunAttemptCount(2).build();
        last.http = first.http; assertEquals(ListenableWorker.Result.failure(), last.doWork());
        context.getSharedPreferences("receiving.push.control", 0).edit().putBoolean("disabled", true).commit();
        assertNull(PushSession.load(context)); assertEquals(ListenableWorker.Result.success(), last.doWork());
        assertTrue(FollowupNotifications.foreground(context, new JSONObject().put("kind", "followup"), "stale event"));
        assertEquals(0, manager.getActiveNotifications().length);
    }
}

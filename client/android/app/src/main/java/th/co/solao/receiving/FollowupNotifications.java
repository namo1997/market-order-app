package th.co.solao.receiving;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONObject;
import org.json.JSONArray;

/** One durable reservation for foreground, FCM redelivery and background polling. */
public final class FollowupNotifications {
    private FollowupNotifications() {}
    static synchronized boolean deliver(Context context, PushSession session, int id, String body) {
        if (id <= 0 || session == null || !session.current(context)) return false;
        SharedPreferences seen = context.getSharedPreferences("receiving.push.seen", Context.MODE_PRIVATE);
        String key = session.origin + ":" + session.userId + ":" + id;
        if (seen.getBoolean(key, false)) return false;
        if (!UrgentNotifications.permitted(context)) return false;
        // Commit before notify. Release on failure; no audible duplicate after process death.
        if (!seen.edit().putBoolean(key, true).commit()) return false;
        try {
            JSONObject data = new JSONObject().put("kind", "followup").put("followup_id", String.valueOf(id))
                .put("user_id", session.userId).put("origin", session.origin);
            UrgentNotifications.post(context, id, "เรื่องด่วนตามของ", body, data.toString());
            return true;
        } catch (Exception ignored) { seen.edit().remove(key).commit(); return false; }
    }
    static boolean foreground(Context context, JSONObject data, String body) {
        if (!"followup".equals(data.optString("kind"))) return false;
        PushSession session = PushSession.load(context);
        if (session == null) return true; // Consume stale foreground events without posting after logout.
        JSONArray ids = data.optJSONArray("followup_ids");
        if (ids != null) for (int i = 0; i < Math.min(50, ids.length()); i++) {
            String id = ids.optString(i);
            if (id.matches("[1-9][0-9]{0,8}")) deliver(context, session, Integer.parseInt(id), body);
        }
        return true;
    }
}

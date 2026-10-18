package th.co.solao.receiving;

import android.content.Context;
import org.json.JSONObject;
import java.net.URI;

/** Reuses Capacitor's app-private session; no second bearer store or WorkManager input token. */
final class PushSession {
    final String origin, token, userId;
    final int branchId;
    private PushSession(String origin, String token, String userId, int branchId) {
        this.origin = origin; this.token = token; this.userId = userId; this.branchId = branchId;
    }
    static PushSession load(Context context) {
        try {
            if (context.getSharedPreferences("receiving.push.control", Context.MODE_PRIVATE).getBoolean("disabled", false)) return null;
            String raw = context.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE)
                .getString("receiving.session.v1", "");
            JSONObject saved = new JSONObject(raw), user = saved.getJSONObject("user");
            String origin = saved.getString("origin"), token = saved.getString("token"), role = user.getString("role");
            URI uri = new URI(origin);
            if (!"https".equals(uri.getScheme()) || uri.getHost() == null || uri.getUserInfo() != null ||
                uri.getRawQuery() != null || uri.getRawFragment() != null || !uri.getPath().isEmpty() ||
                token.isEmpty() || user.optInt("branch_id", 0) <= 0 || !user.optString("id").matches("[1-9][0-9]*") ||
                !(role.equals("admin") || role.equals("super_admin") || role.equals("accounting") || role.equals("accountant"))) return null;
            return new PushSession(origin, token, user.getString("id"), user.getInt("branch_id"));
        } catch (Exception ignored) { return null; }
    }
    boolean current(Context context) {
        PushSession latest = load(context);
        return latest != null && branchId == latest.branchId && origin.equals(latest.origin) && userId.equals(latest.userId) && token.equals(latest.token);
    }
}

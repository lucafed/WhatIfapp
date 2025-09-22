import 'package:shared_preferences/shared_preferences.dart';

class UsageLimitService {
  static const _kCountKey = 'whatif_count';
  static const _kDateKey  = 'whatif_date';
  static const int dailyLimit = 3;

  static Future<bool> canAsk() async {
    final sp = await SharedPreferences.getInstance();
    final today = DateTime.now().toIso8601String().substring(0,10);
    final last = sp.getString(_kDateKey);
    if (last != today) {
      await sp.setString(_kDateKey, today);
      await sp.setInt(_kCountKey, 0);
    }
    final count = sp.getInt(_kCountKey) ?? 0;
    return count < dailyLimit;
  }

  static Future<int> remaining() async {
    final sp = await SharedPreferences.getInstance();
    final today = DateTime.now().toIso8601String().substring(0,10);
    final last = sp.getString(_kDateKey);
    if (last != today) {
      return dailyLimit;
    }
    final count = sp.getInt(_kCountKey) ?? 0;
    return (dailyLimit - count).clamp(0, dailyLimit);
  }

  static Future<void> increment() async {
    final sp = await SharedPreferences.getInstance();
    final today = DateTime.now().toIso8601String().substring(0,10);
    final last = sp.getString(_kDateKey);
    if (last != today) {
      await sp.setString(_kDateKey, today);
      await sp.setInt(_kCountKey, 0);
    }
    final count = sp.getInt(_kCountKey) ?? 0;
    await sp.setInt(_kCountKey, count + 1);
  }
}

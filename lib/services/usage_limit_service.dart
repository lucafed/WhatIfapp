import 'package:shared_preferences/shared_preferences.dart';

class UsageLimitService {
  static const _kDayKey = 'whatif_day';
  static const _kCountKey = 'whatif_count';
  static const freeDaily = 3;

  static Future<(int used, int left)> status() async {
    final sp = await SharedPreferences.getInstance();
    final today = DateTime.now().toIso8601String().substring(0,10);
    final day = sp.getString(_kDayKey);
    int count = sp.getInt(_kCountKey) ?? 0;
    if (day != today) { count = 0; await sp.setString(_kDayKey, today); await sp.setInt(_kCountKey, count); }
    return (count, (freeDaily - count).clamp(0, freeDaily));
    }

  static Future<bool> canAsk() async {
    final s = await status();
    return s.$1 < freeDaily;
  }

  static Future<void> increment() async {
    final sp = await SharedPreferences.getInstance();
    final s = await status();
    await sp.setInt(_kCountKey, s.$1 + 1);
  }
}

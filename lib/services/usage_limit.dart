import 'package:shared_preferences/shared_preferences.dart';

class UsageLimitService {
  static const _kCount = 'usage_count';
  static const _kDate  = 'usage_date';
  static const int dailyFreeLimit = 3;

  static String _todayKey() {
    final now = DateTime.now();
    return '${now.year}-${now.month}-${now.day}';
  }

  static Future<bool> canUse() async {
    final sp = await SharedPreferences.getInstance();
    final day = sp.getString(_kDate);
    var cnt = sp.getInt(_kCount) ?? 0;

    if (day != _todayKey()) {
      await sp.setString(_kDate, _todayKey());
      await sp.setInt(_kCount, 0);
      cnt = 0;
    }
    return cnt < dailyFreeLimit;
  }

  static Future<int> incrementAndGet() async {
    final sp = await SharedPreferences.getInstance();
    if (sp.getString(_kDate) != _todayKey()) {
      await sp.setString(_kDate, _todayKey());
      await sp.setInt(_kCount, 0);
    }
    final next = (sp.getInt(_kCount) ?? 0) + 1;
    await sp.setInt(_kCount, next);
    return next;
  }

  static Future<int> remainingToday() async {
    final sp = await SharedPreferences.getInstance();
    final day = sp.getString(_kDate);
    var cnt = sp.getInt(_kCount) ?? 0;
    if (day != _todayKey()) cnt = 0;
    final left = dailyFreeLimit - cnt;
    return left.clamp(0, dailyFreeLimit);
  }
}

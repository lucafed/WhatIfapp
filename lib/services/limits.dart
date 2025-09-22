import 'storage.dart';

class UsageLimitService {
  static const int dailyFreeLimit = 3;

  static Future<bool> canAsk() async {
    final used = await Storage.getTodayCount();
    return used < dailyFreeLimit;
  }

  static Future<void> increment() => Storage.incToday();
}

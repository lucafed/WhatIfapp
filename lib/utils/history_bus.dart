import 'package:flutter/foundation.dart';

class HistoryBus extends ChangeNotifier {
  HistoryBus._();
  static final instance = HistoryBus._();

  /// Chiama questo dopo aver aggiunto una entry in Storage
  void bump() => notifyListeners();
}

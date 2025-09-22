class ResultEntry {
  final String scenario; // 'slidingDoors' | 'whatTheF'
  final String text;
  final int probability; // 0..100
  bool expanded;

  ResultEntry({
    required this.scenario,
    required this.text,
    required this.probability,
    this.expanded = false,
  });
}

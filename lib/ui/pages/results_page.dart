import 'package:flutter/material.dart';
import '../../models/history_entry.dart';
import '../widgets/probability_meter.dart';
import '../widgets/share_buttons.dart';
import '../widgets/sliding_door.dart';
import '../widgets/wtf_portal.dart';

class ResultsPage extends StatefulWidget {
  final HistoryEntry entry;
  const ResultsPage({super.key, required this.entry});
  @override
  State<ResultsPage> createState() => _ResultsPageState();
}

class _ResultsPageState extends State<ResultsPage> {
  double _p = 0;
  @override
  void initState(){ super.initState(); Future.delayed(const Duration(milliseconds: 50), () => setState(()=>_p = 1)); }
  @override
  Widget build(BuildContext context) {
    final e = widget.entry;
    return Scaffold(
      appBar: AppBar(title: const Text("Risultati")),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          SizedBox(height: 160, child: Stack(children: [
            if (e.scenario == 'slidingDoors') SlidingDoor(progress: _p) else WtfPortal(progress: _p),
            const Positioned.fill(child: IgnorePointer(child: SizedBox())),
          ])),
          const SizedBox(height: 16),
          Text("Domanda", style: Theme.of(context).textTheme.titleMedium),
          Text(e.question),
          const SizedBox(height: 16),
          Text("Scenario realistico", style: Theme.of(context).textTheme.titleMedium),
          Text(e.answerReal),
          const SizedBox(height: 8),
          ProbabilityMeter(value: e.probabilityReal, label: "Probabilità (realistica)"),
          const SizedBox(height: 16),
          Text("Scenario What the F?!", style: Theme.of(context).textTheme.titleMedium),
          Text(e.answerWtf),
          const SizedBox(height: 8),
          ProbabilityMeter(value: e.probabilityWtf, label: "Probabilità (ironica)"),
          const SizedBox(height: 16),
          ShareButtons(text: "What?f: ${e.question} • Real: ${e.answerReal} • WTF: ${e.answerWtf}"),
        ],
      ),
    );
  }
}

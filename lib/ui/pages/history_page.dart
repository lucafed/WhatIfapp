import 'package:flutter/material.dart';
import '../../services/history_store.dart';
import '../../models/history_entry.dart';

class HistoryPage extends StatefulWidget {
  const HistoryPage({super.key});
  @override
  State<HistoryPage> createState() => _HistoryPageState();
}

class _HistoryPageState extends State<HistoryPage> {
  Future<List<HistoryEntry>> _load() => HistoryStore.instance.all();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text("Cronologia")),
      body: FutureBuilder(
        future: _load(),
        builder: (context, snapshot) {
          if (!snapshot.hasData) return const Center(child: CircularProgressIndicator());
          final items = snapshot.data!;
          if (items.isEmpty) return const Center(child: Text("Ancora vuota"));
          return ListView.separated(
            itemCount: items.length,
            separatorBuilder: (_, __) => const Divider(height: 1),
            itemBuilder: (context, i) {
              final e = items[i];
              return ListTile(
                title: Text(e.question),
                subtitle: Text("${e.scenario} • ${e.side} • ${(e.probabilityReal*100).toStringAsFixed(0)}%"),
                trailing: Row(mainAxisSize: MainAxisSize.min, children: [
                  const Icon(Icons.favorite, size: 16),
                  const SizedBox(width: 4),
                  Text(e.likes.toString()),
                ]),
                onLongPress: () async { await HistoryStore.instance.like(e.id); setState(() {});},
              );
            },
          );
        },
      ),
    );
  }
}

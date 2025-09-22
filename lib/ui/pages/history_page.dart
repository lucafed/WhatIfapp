import 'package:flutter/material.dart';
import '../../services/storage.dart';
import '../../models/history_entry.dart';

class HistoryPage extends StatefulWidget {
  const HistoryPage({super.key});

  @override
  State<HistoryPage> createState() => _HistoryPageState();
}

class _HistoryPageState extends State<HistoryPage> {
  List<HistoryEntry> items = [];
  String order = 'recent'; // recent | liked

  Future<void> _load() async {
    final list = await Storage.loadHistory();
    setState(() => items = list);
  }

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  Widget build(BuildContext context) {
    final sorted = [...items];
    if (order == 'liked') {
      sorted.sort((a, b) => (b.liked ? 1 : 0) - (a.liked ? 1 : 0));
    }

    return Scaffold(
      appBar: AppBar(
        title: const Text('Cronologia'),
        actions: [
          PopupMenuButton<String>(
            onSelected: (v) => setState(() => order = v),
            itemBuilder: (_) => const [
              PopupMenuItem(value: 'recent', child: Text('Più recenti')),
              PopupMenuItem(value: 'liked', child: Text('Preferiti in alto')),
            ],
          ),
        ],
      ),
      body: ListView.builder(
        padding: const EdgeInsets.all(12),
        itemCount: sorted.length,
        itemBuilder: (_, i) {
          final e = sorted[i];
          return Card(
            child: ListTile(
              title: Text(e.question),
              subtitle: Text('${e.side} • ${e.scenario} • ${DateTime.parse(e.createdAt)}'),
              trailing: Icon(e.liked ? Icons.favorite : Icons.favorite_border, color: e.liked ? Colors.pink : null),
              onTap: () => Navigator.of(context).pushNamed('/results', arguments: e),
            ),
          );
        },
      ),
    );
  }
}

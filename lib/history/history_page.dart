import 'package:flutter/material.dart';
import 'package:whatifapp/history/history_store.dart';

class HistoryPage extends StatefulWidget {
  const HistoryPage({super.key});

  @override
  State<HistoryPage> createState() => _HistoryPageState();
}

class _HistoryPageState extends State<HistoryPage> {
  @override
  void initState() {
    super.initState();
    HistoryStore.instance.load();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Cronologia')),
      body: AnimatedBuilder(
        animation: HistoryStore.instance,
        builder: (_, __) {
          final items = HistoryStore.instance.items;
          if (items.isEmpty) {
            return const Center(child: Text('Nessuna domanda ancora.'));
          }
          return ListView.separated(
            itemCount: items.length,
            separatorBuilder: (_, __) => const Divider(height: 1),
            itemBuilder: (_, i) {
              final e = items[i];
              return ListTile(
                title: Text(e.question),
                subtitle: Text('${e.scenario} • ${e.side}'),
                trailing: IconButton(
                  icon: Icon(e.favorite ? Icons.favorite : Icons.favorite_border),
                  onPressed: () => HistoryStore.instance.toggleFavorite(e.id),
                ),
              );
            },
          );
        },
      ),
    );
  }
}

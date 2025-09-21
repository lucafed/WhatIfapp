import 'package:flutter/material.dart';
import '../models/history_entry.dart';
import '../utils/storage.dart';

class HistoryPage extends StatefulWidget {
  const HistoryPage({super.key});
  @override
  State<HistoryPage> createState() => _HistoryPageState();
}

class _HistoryPageState extends State<HistoryPage> {
  List<HistoryEntry> _items = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final data = await Storage.loadHistory();
    setState(() { _items = data; _loading = false; });
  }

  Future<void> _toggleLike(HistoryEntry e) async {
    await Storage.toggleLike(e);
    await _load();
  }

  Future<void> _clear() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Svuota cronologia?'),
        content: const Text('Questa azione non può essere annullata.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Annulla')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Svuota')),
        ],
      ),
    );
    if (ok == true) {
      await Storage.clearHistory();
      await _load();
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Cronologia svuotata')),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_items.isEmpty) {
      return Center(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          const Icon(Icons.history, size: 54),
          const SizedBox(height: 8),
          Text('Nessuna domanda ancora', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 4),
          const Text('Apri una porta dalla Home per vedere qui la cronologia.')
        ]),
      );
    }
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
          child: Row(
            children: [
              Text('Cronologia', style: Theme.of(context).textTheme.titleLarge),
              const Spacer(),
              IconButton(
                tooltip: 'Svuota',
                onPressed: _clear,
                icon: const Icon(Icons.delete_outline),
              ),
            ],
          ),
        ),
        const Divider(height: 1),
        Expanded(
          child: RefreshIndicator(
            onRefresh: _load,
            child: ListView.separated(
              padding: const EdgeInsets.all(12),
              itemCount: _items.length,
              separatorBuilder: (_, __) => const SizedBox(height: 8),
              itemBuilder: (_, i) {
                final e = _items[i];
                return Card(
                  child: ListTile(
                    title: Text(e.question),
                    subtitle: Text('${e.scenario} • ${e.timeSide} • ${e.createdAt}'),
                    trailing: IconButton(
                      onPressed: () => _toggleLike(e),
                      icon: Icon(e.liked ? Icons.favorite : Icons.favorite_border),
                      color: e.liked ? Colors.pink : null,
                    ),
                  ),
                );
              },
            ),
          ),
        ),
      ],
    );
  }
}

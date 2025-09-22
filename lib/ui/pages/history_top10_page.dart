import 'package:flutter/material.dart';

class HistoryTop10Page extends StatelessWidget {
  const HistoryTop10Page({super.key});

  @override
  Widget build(BuildContext context) {
    // Stub: collegare a HistoryStore.instance.items dove favorite=true
    return Scaffold(
      appBar: AppBar(title: const Text('Top 10')),
      body: const Center(child: Text('Qui compariranno le 10 domande più “liked”.')),
    );
  }
}

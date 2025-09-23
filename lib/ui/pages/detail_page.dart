import 'package:flutter/material.dart';

class DetailPage extends StatelessWidget {
  const DetailPage({super.key});

  @override
  Widget build(BuildContext context) {
    final int index = ModalRoute.of(context)?.settings.arguments as int? ?? 0;

    return Scaffold(
      appBar: AppBar(title: Text('Scelta #${index + 1}')),
      body: const Center(
        child: Padding(
          padding: EdgeInsets.all(24.0),
          child: Text(
            'Qui metteremo l’esito della scelta, grafici, testi e pulsanti per esplorare alternative.',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 18, height: 1.4),
          ),
        ),
      ),
    );
  }
}

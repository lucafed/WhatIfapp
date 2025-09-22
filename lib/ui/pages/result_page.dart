import 'package:flutter/material.dart';

class ResultPage extends StatelessWidget {
  final String question;
  const ResultPage({super.key, required this.question});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text("Risultati")),
      body: Center(child: Text("Risultati per: \$question")),
    );
  }
}

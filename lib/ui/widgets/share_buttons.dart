import 'package:flutter/material.dart';
import 'dart:html' as html;

class ShareButtons extends StatelessWidget {
  final String text;
  const ShareButtons({super.key, required this.text});
  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 8,
      children: [
        FilledButton.tonal(
          onPressed: () {
            final url = Uri.encodeComponent(html.window.location.href);
            final t = Uri.encodeComponent(text);
            html.window.open('https://twitter.com/intent/tweet?url=$url&text=$t','_blank');
          },
          child: const Text("Condividi X"),
        ),
        FilledButton.tonal(
          onPressed: () { html.window.navigator.clipboard?.writeText(text); ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Copiato!'))); },
          child: const Text("Copia testo"),
        ),
      ],
    );
  }
}

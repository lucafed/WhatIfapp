import 'package:flutter/material.dart';

class ProbabilityMeter extends StatelessWidget {
  final double value; // 0..1
  final String label;
  const ProbabilityMeter({super.key, required this.value, required this.label});
  @override
  Widget build(BuildContext context) {
    final v = value.clamp(0,1);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: Theme.of(context).textTheme.labelLarge),
        const SizedBox(height: 6),
        ClipRRect(
          borderRadius: BorderRadius.circular(12),
          child: LinearProgressIndicator(minHeight: 12, value: v?.toDouble()?.toDouble()?.toDouble()),
        ),
        const SizedBox(height: 4),
        Text("${(v*100).toStringAsFixed(0)}%"),
      ],
    );
  }
}

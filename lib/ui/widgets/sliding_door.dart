import 'package:flutter/material.dart';

class SlidingDoor extends StatelessWidget {
  final double progress; // 0..1
  const SlidingDoor({super.key, required this.progress});
  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        Positioned.fill(
          child: Container(
            decoration: const BoxDecoration(
              gradient: LinearGradient(
                colors: [Color(0xFF0D1B1E), Color(0xFF102A43)],
              ),
            ),
          ),
        ),
        Align(
          alignment: Alignment.centerLeft,
          child: FractionallySizedBox(
            widthFactor: (1 - progress) / 2 + .05,
            child: Container(color: Colors.black.withOpacity(.7)),
          ),
        ),
        Align(
          alignment: Alignment.centerRight,
          child: FractionallySizedBox(
            widthFactor: (1 - progress) / 2 + .05,
            child: Container(color: Colors.black.withOpacity(.7)),
          ),
        ),
        Center(
          child: Container(
            width: 6, height: 120,
            decoration: BoxDecoration(
              color: Colors.cyanAccent.withOpacity(.8),
              boxShadow: [BoxShadow(color: Colors.cyanAccent.withOpacity(.5), blurRadius: 20)],
            ),
          ),
        ),
      ],
    );
  }
}

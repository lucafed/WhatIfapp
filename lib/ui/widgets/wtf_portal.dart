import 'dart:math' as math;
import 'package:flutter/material.dart';

class WtfPortal extends StatefulWidget {
  final double progress; // 0..1
  const WtfPortal({super.key, required this.progress});
  @override
  State<WtfPortal> createState() => _WtfPortalState();
}

class _WtfPortalState extends State<WtfPortal> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: const Duration(seconds: 2))..repeat();
  @override
  void dispose() {_c.dispose(); super.dispose();}
  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _c,
      builder: (context, _) {
        return CustomPaint(
          painter: _PortalPainter(_c.value, widget.progress),
          child: const SizedBox.expand(),
        );
      },
    );
  }
}

class _PortalPainter extends CustomPainter {
  final double t;
  final double p;
  _PortalPainter(this.t, this.p);
  @override
  void paint(Canvas canvas, Size size) {
    final center = size.center(Offset.zero);
    final baseR = math.min(size.width, size.height) * 0.35;
    for (int i=0;i<7;i++){
      final r = baseR * (1 - i*0.12) * (0.6 + p*0.6);
      final paint = Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 6 - i.toDouble()
        ..color = HSVColor.fromAHSV(1, (t*360 + i*40)%360, .9, 1).toColor().withOpacity(.9);
      canvas.drawArc(Rect.fromCircle(center: center, radius: r), t*math.pi*2, math.pi*1.5, false, paint);
    }
  }
  @override
  bool shouldRepaint(covariant _PortalPainter old) => old.t != t || old.p != p;
}

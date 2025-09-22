import 'dart:math';
import 'package:flutter/material.dart';
import '../../theme.dart';

class WtfPortal extends StatefulWidget {
  final Duration duration;
  final VoidCallback? onOpened;
  const WtfPortal({super.key, this.duration = const Duration(milliseconds: 900), this.onOpened});

  @override
  State<WtfPortal> createState() => _WtfPortalState();
}

class _WtfPortalState extends State<WtfPortal> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: widget.duration)..forward();

  @override
  void dispose() { _c.dispose(); super.dispose(); }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _c,
      builder: (_, __) {
        final t = Curves.easeInOutCubicEmphasized.transform(_c.value);
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (_c.isCompleted && widget.onOpened != null) widget.onOpened!();
        });
        return CustomPaint(
          painter: _PortalPainter(t),
          child: const SizedBox.expand(),
        );
      },
    );
  }
}

class _PortalPainter extends CustomPainter {
  final double t; _PortalPainter(this.t);
  @override
  void paint(Canvas canvas, Size size) {
    final center = size.center(Offset.zero);
    final maxR = size.shortestSide * .7;
    final rings = 8;
    final paint = Paint()..style = PaintingStyle.stroke;

    for (var i=0; i<rings; i++) {
      final p = i/(rings-1);
      final r = (p * maxR) * t;
      paint.strokeWidth = 6 * (1-p);
      paint.color = Color.lerp(AppTheme.neonPink, AppTheme.acidLime, (sin((p+t)*pi)*.5+.5))!.withOpacity(.8);
      canvas.drawCircle(center, r, paint);
    }
  }
  @override
  bool shouldRepaint(covariant _PortalPainter old) => old.t != t;
}

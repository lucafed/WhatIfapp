import 'package:flutter/material.dart';
import '../../theme.dart';

class SlidingDoor extends StatefulWidget {
  final Duration duration;
  final VoidCallback? onOpened;
  const SlidingDoor({super.key, this.duration = const Duration(milliseconds: 700), this.onOpened});

  @override
  State<SlidingDoor> createState() => _SlidingDoorState();
}

class _SlidingDoorState extends State<SlidingDoor> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: widget.duration)..forward();

  @override
  void dispose() { _c.dispose(); super.dispose(); }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _c,
      builder: (_, __) {
        final t = Curves.easeInOut.transform(_c.value);
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (_c.isCompleted && widget.onOpened != null) widget.onOpened!();
        });
        return Stack(
          children: [
            // bagliore centrale
            Align(
              child: Container(
                width: 6 + 60 * t,
                decoration: BoxDecoration(
                  boxShadow: [BoxShadow(color: AppTheme.turquoise.withOpacity(.8), blurRadius: 40, spreadRadius: 8)],
                ),
              ),
            ),
            // ante porta
            Row(
              children: [
                Expanded(child: Transform.translate(offset: Offset(-MediaQuery.of(context).size.width * t, 0), child: _panel())),
                Expanded(child: Transform.translate(offset: Offset( MediaQuery.of(context).size.width * t, 0), child: _panel(mirror:true))),
              ],
            ),
          ],
        );
      },
    );
  }

  Widget _panel({bool mirror=false}) {
    return Container(
      height: double.infinity,
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: mirror ? Alignment.centerRight : Alignment.centerLeft,
          end: mirror ? Alignment.centerLeft : Alignment.centerRight,
          colors: [const Color(0xFF0F1630), const Color(0xFF091022)],
        ),
        border: Border(
          right: mirror ? BorderSide.none : BorderSide(color: AppTheme.turquoise.withOpacity(.4), width: 2),
          left:  mirror ? BorderSide(color: AppTheme.turquoise.withOpacity(.4), width: 2) : BorderSide.none,
        ),
      ),
    );
  }
}

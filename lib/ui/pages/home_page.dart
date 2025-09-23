import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

class HomePage extends StatelessWidget {
  const HomePage({super.key});

  @override
  Widget build(BuildContext context) {
    final doors = <_Door>[
      _Door('Bar Jazz', const Color(0xFF00E5FF)),
      _Door('Caffè Letterario', const Color(0xFF00FFA3)),
      _Door('Osteria', const Color(0xFFFFE066)),
      _Door('Speakeasy', const Color(0xFFFF7A7A)),
      _Door('Rooftop', const Color(0xFFB388FF)),
      _Door('Vineria', const Color(0xFF70E000)),
    ];

    return Scaffold(
      backgroundColor: const Color(0xFF0E1116),
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        centerTitle: false,
        titleSpacing: 16,
        title: Row(
          children: [
            SvgPicture.asset(
              'assets/whatif_logo.svg',
              height: 28,
            ),
            const SizedBox(width: 12),
            const Text(
              'Scegli una “porta”',
              style: TextStyle(fontWeight: FontWeight.w600),
            ),
          ],
        ),
      ),
      body: Padding(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
        child: GridView.builder(
          itemCount: doors.length,
          gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: 2,
            mainAxisSpacing: 14,
            crossAxisSpacing: 14,
            childAspectRatio: .85,
          ),
          itemBuilder: (context, i) {
            final d = doors[i];
            return _DoorCard(
              label: d.label,
              color: d.color,
              onTap: () {
                Navigator.push(
                  context,
                  MaterialPageRoute(builder: (_) => _DoorDetailPage(door: d)),
                );
              },
            );
          },
        ),
      ),
    );
  }
}

class _DoorCard extends StatelessWidget {
  final String label;
  final Color color;
  final VoidCallback onTap;
  const _DoorCard({required this.label, required this.color, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(18),
      onTap: onTap,
      child: Ink(
        decoration: BoxDecoration(
          color: const Color(0xFF151A21),
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: Colors.white.withOpacity(.06)),
        ),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Expanded(
                child: Center(
                  child: SvgPicture.asset(
                    'assets/whatif_door.svg',
                    width: 86,
                    colorFilter: ColorFilter.mode(color, BlendMode.srcIn),
                  ),
                ),
              ),
              const SizedBox(height: 10),
              Text(
                label,
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: Colors.white.withOpacity(.95),
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                'Entra',
                style: TextStyle(
                  color: Colors.white.withOpacity(.6),
                  fontSize: 12,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _DoorDetailPage extends StatelessWidget {
  final _Door door;
  const _DoorDetailPage({required this.door, super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0E1116),
      appBar: AppBar(
        title: Text(door.label),
        backgroundColor: Colors.transparent,
        elevation: 0,
      ),
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            SvgPicture.asset(
              'assets/whatif_door.svg',
              width: 140,
              colorFilter: ColorFilter.mode(door.color, BlendMode.srcIn),
            ),
            const SizedBox(height: 18),
            Text(
              'Dettagli porta “${door.label}”\n(placeholder – qui inseriremo i contenuti della checklist).',
              textAlign: TextAlign.center,
              style: TextStyle(color: Colors.white.withOpacity(.9)),
            ),
          ],
        ),
      ),
    );
  }
}

class _Door {
  final String label;
  final Color color;
  const _Door(this.label, this.color);
}

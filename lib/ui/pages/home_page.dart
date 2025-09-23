import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

class HomePage extends StatelessWidget {
  const HomePage({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        backgroundColor: Colors.black,
        elevation: 0,
        title: Row(
          children: [
            SvgPicture.asset('assets/whatif_bar.svg', height: 20),
            const SizedBox(width: 12),
            const Text('What?f'),
          ],
        ),
      ),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: GridView.builder(
          itemCount: 6,
          gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: 2,
            crossAxisSpacing: 12,
            mainAxisSpacing: 12,
            childAspectRatio: .9,
          ),
          itemBuilder: (context, index) => _DoorCard(index: index),
        ),
      ),
    );
  }
}

class _DoorCard extends StatelessWidget {
  final int index;
  const _DoorCard({required this.index});

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: () => Navigator.pushNamed(context, '/detail', arguments: index),
      borderRadius: BorderRadius.circular(16),
      child: Ink(
        decoration: BoxDecoration(
          gradient: const LinearGradient(
            colors: [Color(0xFF101318), Color(0xFF0B0E13)],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: Colors.white10),
        ),
        child: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.door_front_door, size: 52, color: Colors.white70),
              const SizedBox(height: 10),
              Text('Porta #${index + 1}',
                  style: const TextStyle(fontWeight: FontWeight.w700)),
            ],
          ),
        ),
      ),
    );
  }
}

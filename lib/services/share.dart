import 'dart:html' as html;
import 'package:flutter/services.dart';

class ShareService {
  static Future<void> shareText(String text) async {
    try {
      final nav = html.window.navigator;
      if ((nav as dynamic).canShare != null && (nav as dynamic).share != null) {
        await (nav as dynamic).share({'title': 'What?f', 'text': text});
        return;
      }
    } catch (_) {/* fallthrough */}
    // Fallback: copia negli appunti
    await Clipboard.setData(ClipboardData(text: text));
  }
}

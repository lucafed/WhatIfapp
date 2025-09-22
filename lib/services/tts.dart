import 'dart:html' as html;

class TtsService {
  static bool get supported => html.window.speechSynthesis != null;

  static void speak(String text) {
    final synth = html.window.speechSynthesis;
    if (synth == null) return;
    stop();
    final u = html.SpeechSynthesisUtterance(text);
    u.lang = 'it-IT';
    synth.speak(u);
  }

  static void stop() {
    final synth = html.window.speechSynthesis;
    synth?.cancel();
  }
}

<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>What?f – Parlami di te</title>
  <link rel="stylesheet" href="./style.css">
</head>
<body data-prev="./fourth.html">
  <main class="fade-in">
    <div class="container form">

      <h1>Parlami di te</h1>

      <div class="group">
        <span class="label">Sesso</span>
        <div class="chips" id="sex">
          <span class="chip">Femmina</span>
          <span class="chip active">Maschio</span>
          <span class="chip">Altro</span>
          <span class="chip">Preferisco non dirlo</span>
        </div>
      </div>

      <div class="group">
        <span class="label">In quale fase ti trovi?</span>
        <div class="chips" id="phase">
          <span class="chip">Studio</span>
          <span class="chip active">Carriera</span>
          <span class="chip">Relazioni</span>
        </div>
      </div>

      <div class="group">
        <span class="label">Cosa ti interessa esplorare?</span>
        <div class="chips" id="topic">
          <span class="chip active">Passato</span>
          <span class="chip">Futuro</span>
          <!-- rimosse voci duplicate "What if" e "What the F" -->
        </div>
      </div>

      <div class="group">
        <span class="label">Stile della risposta</span>
        <div class="chips" id="style">
          <span class="chip active" data-style="whatif">Whatif</span>
          <span class="chip" data-style="wtf">What the F</span>
        </div>
      </div>

      <div class="group">
        <span class="label">Da dove vieni?</span>
        <input class="input" placeholder="Es. L'Aquila">
      </div>

      <div class="group">
        <span class="label">Vuoi aggiungere qualcosa? <small style="color:var(--muted)">(opzionale)</small></span>
        <input class="input" placeholder="Come vuoi che ti chiami?">
      </div>

      <div class="group">
        <span class="label">Note <small style="color:var(--muted)">(opzionale)</small></span>
        <textarea class="textarea" placeholder="Obiettivi, contesto, limiti di tempo…"></textarea>
      </div>

      <a class="btn" href="#" data-nav>INVIA</a>
      <p class="hint">Swipe → per tornare indietro</p>
    </div>
  </main>

  <footer>© 2025 What?f</footer>
  <script src="./main.js"></script>
  <script>
    // attiva/desattiva chip
    document.querySelectorAll('.chips').forEach(group=>{
      group.addEventListener('click', e=>{
        const c=e.target.closest('.chip'); if(!c) return;
        [...group.children].forEach(x=>x.classList.remove('active'));
        c.classList.add('active');
      });
    });
  </script>
</body>
</html>

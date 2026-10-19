(function () {
  /* index.html, not a trailing slash. Capacitor's stock router serves
     the menu for every URL that has no file extension. */
  var GAMES = [
    ["kart", "/bitcoin-kart/index.html", "/art/kart.svg", "3D racer", "Bitcoin Kart", "Twelve tracks and on-screen touch controls."],
    ["saylor", "/super-saylor/index.html", "/art/saylor.svg", "Platformer", "Super Saylor", "Twenty-one levels through bitcoin history."],
    ["chop", "/chop/index.html", "/art/chop.svg", "Swipe", "CHOP", "Slice cubes from a saved real block."],
    ["wen", "/wen/index.html", "/art/wen.svg", "Daily puzzle", "WEN", "Date a 90-day slice of the price tape."],
    ["gauntlet", "/gauntlet/index.html", "/art/gauntlet.svg", "Daily", "The Bitcoin Gauntlet", "A hidden stretch of history against a DCA bot."],
    ["runner", "/runner/index.html", "/art/runner.svg", "One tap", "Node Runner", "Jump the shape of the price tape."],
    ["horizon", "/horizon/index.html", "/art/horizon.svg", "One tap", "Timechain", "Stack blocks. The points get smaller as you climb."],
    ["trail", "/trail/index.html", "/art/trail.svg", "Daily story", "The HODL Trail", "Ten choices through bitcoin history."],
  ];

  var grid = document.getElementById("grid");
  var modal = document.getElementById("modal");

  function scores() {
    try { return JSON.parse(localStorage.getItem("gm:native:scores") || "{}") || {}; }
    catch (e) { return {}; }
  }

  function bestLine(all, id) {
    var row = all[id];
    if (!row && id === "saylor") row = all.summit;
    if (!row || typeof row.score !== "number") return "No score yet";
    return "Best " + Math.round(row.score).toLocaleString("en-US");
  }

  function render() {
    var all = scores();
    grid.textContent = "";
    GAMES.forEach(function (g) {
      var a = document.createElement("a");
      a.className = "card";
      a.href = g[1];
      var thumb = document.createElement("img");
      thumb.className = "thumb";
      thumb.src = g[2];
      thumb.alt = "";
      thumb.draggable = false;
      var eye = document.createElement("p");
      eye.className = "eyebrow";
      eye.textContent = g[3];
      var h = document.createElement("h2");
      h.textContent = g[4];
      var p = document.createElement("p");
      p.textContent = g[5];
      var row = document.createElement("div");
      row.className = "row";
      var best = document.createElement("span");
      best.className = "best";
      best.textContent = bestLine(all, g[0]);
      var play = document.createElement("span");
      play.className = "play";
      play.textContent = "Play";
      row.appendChild(best);
      row.appendChild(play);
      var copy = document.createElement("div");
      copy.className = "copy";
      copy.appendChild(eye);
      copy.appendChild(h);
      copy.appendChild(p);
      copy.appendChild(row);
      a.appendChild(thumb);
      a.appendChild(copy);
      grid.appendChild(a);
    });
  }

  function openSite() {
    if (window.GM_OPEN_EXTERNAL) window.GM_OPEN_EXTERNAL("https://galaxymind.space/");
  }
  document.getElementById("site").addEventListener("click", openSite);
  document.getElementById("more").addEventListener("click", openSite);
  document.getElementById("privacy").addEventListener("click", function () {
    if (window.GM_OPEN_EXTERNAL) window.GM_OPEN_EXTERNAL("https://galaxymind.space/privacy");
  });

  document.getElementById("accept").addEventListener("click", function () {
    try { localStorage.setItem("gm:native:disclaimer", "1"); } catch (e) {}
    modal.hidden = true;
  });

  if (localStorage.getItem("gm:native:disclaimer") === "1") modal.hidden = true;
  else modal.hidden = false;

  render();
  window.addEventListener("pageshow", render);
})();

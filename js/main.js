$(function () {
  
  // ===========================================
  // 定数 / 状態
  // ===========================================

  const STORAGE_KEY = "mitemoto";
  const MAX_KEYWORDS = 3;

  // スピーチ全体のデータ。localStorageには以下の構造で保存される:
  //   キー: "mitemoto"
  //   値:   { title: "タイトル", cards: [ { outline, trigger, keywords[] }, ... ] }
  //
  // titleをキーにしていないのは、タイトルが変わるたびに古いキーの削除が必要になるため。
  // "mitemoto"に固定することで、何が変わってもsave()の1行で丸ごと上書きできる。
  let speech = { title: "", cards: [makeBlankCard()] };

  // 本番画面で表示中のカード番号（speech.cards[currentCardIdx]）
  let currentCardIdx = 0;

  // ストップウォッチ用（経過秒数・setIntervalのID・3秒待機のsetTimeoutのID）
  let timerSeconds = 0;
  let timerInterval = null;
  let timerTimeout = null;


  // ===========================================
  // 共通利用
  // ===========================================

  // カード（speech.cards）の構造を定義した初期データを返す関数
  function makeBlankCard() {
    return { outline: "", trigger: "", keywords: [] };
  }

  // ユーザーが入力した文字列をHTMLに埋め込む前に無害化する（例: < → &lt;）。これをしないとスクリプトが実行されてしまう
  function escapeHtml(s) {
    return String(s).replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  }

  // "#screenEdit" と"#screenPlay" を表示する
  function showScreen(name) {
    $(".screen").addClass("hidden");
    $("#screen" + name).removeClass("hidden");
  }

  // 確認ダイアログを表示する。
  // onOk は呼び出し側が第2引数として渡す関数（コールバック）。
  // 例: showConfirm("削除しますか？", function() { 削除処理 });
  //     → OKが押されたとき、この function の中身が実行される。
  function showConfirm(message, onOk) {
    $("#modalMsg").text(message);
    $("#modalOverlay").removeClass("hidden");
    $("#modalOk").off("click").on("click", function () {
      $("#modalOverlay").addClass("hidden");
      onOk();
    });
    $("#modalCancel").off("click").on("click", function () {
      $("#modalOverlay").addClass("hidden");
    });
  }

  // localStorageからデータを読み込む（localStorageから データを取ってきて speech に入れる）
  function load() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      speech = JSON.parse(raw);
    }
  }

  // localStorageにデータを保存する
  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(speech));
    updatePlayBtn();
  }

  // 本番ボタンの活性・非活性を切り替える（コンテンツのあるカードが1枚以上あればアクティブ）
  function updatePlayBtn() {
    let hasContent = false;
    for (let i = 0; i < speech.cards.length; i++) {
      const c = speech.cards[i];
      if (c.trigger.trim() && c.outline.trim() && c.keywords.length > 0) {
        hasContent = true;
        break;
      }
    }
    $("#startPlay").prop("disabled", !hasContent);
  }



  // ===========================================
  // 編集画面：画面出力
  // ===========================================

  // 【カード一覧の出力】speech.cardsのデータを読んで、カード一覧のHTMLを生成して画面に表示する（読み込むのは JSオブジェクトの speech で、localStorageには触っていない）
  function renderEditor() {

    // #cardList の中身（カードのHTML）を全部消して空の箱にする。
    // 箱自体（#cardList）は残り、list に入れておく。この後 list.append(item) で1枚ずつ追加する。
    const list = $("#cardList").empty();

    // カードを１枚ずつ出力する
    for (let i = 0; i < speech.cards.length; i++) {
      const c = speech.cards[i];
      const item = $(`
        <div class="edit-card" data-idx="${i}">
          <div class="edit-card-head">
            <div class="edit-card-num">カード ${i + 1}</div>
            <div class="edit-card-actions">
              <button class="up" title="上へ">↑</button>
              <button class="down" title="下へ">↓</button>
              ${speech.cards.length > 1 ? '<button class="del" title="削除">×</button>' : ""}
            </div>
          </div>
           <div class="field">
            <label class="field-label">構成メモ</label>
            <textarea class="f-outline" rows="1" placeholder="例: 全体像の提示"></textarea>
          </div>
          <div class="field">
            <label class="field-label">きっかけ<span class="small">話し始めの合図</span></label>
            <textarea class="f-trigger" rows="1" placeholder="例: 今日お話したいことは３つ"></textarea>
          </div>

          <div class="field">
            <label class="field-label">キーワード <span class="kw-counter">0 / ${MAX_KEYWORDS}</span></label>
            <div class="kw-zone">
              <input class="kw-input">
            </div>
          </div>
        </div>
      `);

      // 保存データをテキストエリアに反映
      item.find(".f-trigger").val(c.trigger);
      item.find(".f-outline").val(c.outline);

      // キーワードを出力
      renderKeywords(item, c.keywords);

      // データが入ったカードを #cardList（空の箱）に追加。ループのたびに1枚ずつ追加
      list.append(item);
    }

    // カード枚数の表示を更新
    const n = speech.cards.length;
    $("#totalInfo").text(`${n}枚 / 目安${n}分`);
    
    // テキストエリアの高さを内容に合わせて調整
    $("#cardList textarea").each(function () {
      this.style.height = "auto";
      this.style.height = this.scrollHeight + "px";
    });
  }

  // 【キーワードの出力】speech.cards[idx].keywords を kws として受け取り、タグ形式のHTMLを生成して画面に表示する（localStorageには触っていない）
  function renderKeywords(item, kws) {

    // キーワードエリアを取得
    const zone = item.find(".kw-zone");

    // 画面上に表示されているキーワードのタグを一度消す。リセット
    zone.find(".kw-chip").remove();

    // キーワードを入力するテキストボックスを取得
    const input = zone.find(".kw-input");

    // キーワードを順番に出力
    for (let i = 0; i < kws.length; i++) {
      input.before(
        `<span class="kw-chip" data-ki="${i}">${escapeHtml(kws[i])}<span class="x">×</span></span>`,
      );
    }

    //キーワードの個数を出力 
    const counter = item.find(".kw-counter");
    counter.text(`${kws.length} / ${MAX_KEYWORDS}`);

    // 最大キーワードに達したときにラベルの色をCSSで変える時の設定。addClass はクラスを追加するだけ、toggleClass は条件に応じて付けたり外したりする。
    counter.toggleClass("full", kws.length >= MAX_KEYWORDS);

    // 最大キーワード数を超えていたら入力欄が非活性
    input.prop("disabled", kws.length >= MAX_KEYWORDS);

    // 入力欄のプレースホルダーの表示内容。最大キーワードを超えていたら「？」（真）。超えていなければ「：」（偽）
    input.attr(
      "placeholder",
      kws.length >= MAX_KEYWORDS
        ? "上限に達しました"
        : "例: メモの大切さ/カンペの大切さ/...",
    );
  }



  // ===========================================
  // 編集画面：タイトル入力
  // ===========================================

  // どの欄でEnterが1回押されたかを記憶する（Enter×2確定に使用）。タイトル・きっかけ・構成メモ・キーワード、すべての入力欄で共通して使う変数。
  let enterPendingEl = null;

  // タイトル入力 → 即時保存
  $("#speechTitle").on("input", function () {
    speech.title = $(this).val();
    save();
  });

  // Enterを2回で確定（フォーカスを外す）
  $("#speechTitle").on("keydown", function (e) {

    // Enter以外のキーを押したら初期化される
    if (e.key !== "Enter") { enterPendingEl = null; return; }
    e.preventDefault();

    // 　一度Enterキーを押して、もう一度Enterキーを押したら「確定」し、初期化する
    if (enterPendingEl === this) { $(this).blur(); enterPendingEl = null; }

    // それ以外の場合、つまり一度Enterキーを押したら、確定待機状態とする（enterPendingEl === this）
    else { enterPendingEl = this; }
  });

  $("#speechTitle").on("blur", function () { enterPendingEl = null; });

  // ===========================================
  // 編集画面：構成メモ・きっかけの入力
  // ===========================================

  // きっかけ・構成メモの入力 → 即時保存 + テキストエリアの高さ調整
  $("#cardList").on("input", ".f-trigger", function () {
    const idx = $(this).closest(".edit-card").data("idx");
    speech.cards[idx].trigger = $(this).val();
    save();
    this.style.height = "auto";
    this.style.height = this.scrollHeight + "px";
  });

  $("#cardList").on("input", ".f-outline", function () {
    const idx = $(this).closest(".edit-card").data("idx");
    speech.cards[idx].outline = $(this).val();
    save();
    this.style.height = "auto";
    this.style.height = this.scrollHeight + "px";
  });

  // Enterを2回で確定（フォーカスを外す）
  $("#cardList").on("keydown", ".f-trigger, .f-outline", function (e) {
    if (e.key !== "Enter") { enterPendingEl = null; return; }
    e.preventDefault();
    if (enterPendingEl === this) { $(this).blur(); enterPendingEl = null; }
    else { enterPendingEl = this; }
  });

  $("#cardList").on("blur", ".f-trigger, .f-outline", function () { enterPendingEl = null; });

  // ===========================================
  // 編集画面：キーワードの入力・操作
  // ===========================================

  // キーワードをデータに追加する（空・重複・上限超えは無視）
  function addKeyword(item, value) {
    const idx = item.data("idx");
    const v = value.trim().replace(/[,、]/g, "");
    const kws = speech.cards[idx].keywords;
    if (!v || kws.length >= MAX_KEYWORDS || kws.includes(v)) return;
    kws.push(v);
    save();
    renderKeywords(item, kws);
  }

  // Enterを2回でキーワードを追加
  $("#cardList").on("keydown", ".kw-input", function (e) {
    if (e.key !== "Enter") { enterPendingEl = null; return; }
    e.preventDefault();
    if (enterPendingEl === this) {
      addKeyword($(this).closest(".edit-card"), $(this).val());
      $(this).val("");
      enterPendingEl = null;
    } else {
      enterPendingEl = this;
    }
  });

  // フォーカスが外れたらEnterの1回目をリセット
  $("#cardList").on("blur", ".kw-input", function () { enterPendingEl = null; });

  // キーワードの × で削除
  $("#cardList").on("click", ".kw-chip .x", function () {
    const chip = $(this).parent();
    const item = chip.closest(".edit-card");
    const idx = item.data("idx");
    const ki = chip.data("ki");
    speech.cards[idx].keywords.splice(ki, 1);
    save();
    renderKeywords(item, speech.cards[idx].keywords);
  });

  // ===========================================
  // 編集画面：カード操作
  // ===========================================

  // カードを削除
  $("#cardList").on("click", ".del", function () {
    const idx = $(this).closest(".edit-card").data("idx");
    showConfirm(`カード${idx + 1}を削除しますか？`, function () {
      speech.cards.splice(idx, 1);
      save();
      renderEditor();
    });
  });

  // カードを上へ移動（前の要素と入れ替え）
  $("#cardList").on("click", ".up", function () {
    const idx = $(this).closest(".edit-card").data("idx");
    if (idx === 0) return;
    [speech.cards[idx - 1], speech.cards[idx]] = [
      speech.cards[idx],
      speech.cards[idx - 1],
    ];
    save();
    renderEditor();
  });

  // カードを下へ移動（次の要素と入れ替え）
  $("#cardList").on("click", ".down", function () {
    const idx = $(this).closest(".edit-card").data("idx");
    if (idx === speech.cards.length - 1) return;
    [speech.cards[idx + 1], speech.cards[idx]] = [
      speech.cards[idx],
      speech.cards[idx + 1],
    ];
    save();
    renderEditor();
  });

  // 空カードをデータに追加して画面を更新し、HTML生成完了を待ってから最下部へスクロール
  $("#addCard").on("click", function () {
    speech.cards.push(makeBlankCard());
    save();
    renderEditor();
    setTimeout(() => {
      const el = document.querySelector(".edit-body");
      el.scrollTop = el.scrollHeight;
    }, 50);
  });

  // スピーチを全削除して最初からやり直す（localStorageのデータも削除する）
  $("#resetSpeech").on("click", function () {
    showConfirm("スピーチをすべて削除して最初からやり直しますか？", function () {
      speech = { title: "", cards: [makeBlankCard()] };
      localStorage.removeItem(STORAGE_KEY);
      $("#speechTitle").val("");
      renderEditor();
      updatePlayBtn();
    });
  });



  // ===========================================
  // 編集画面：本番画面への遷移
  // ===========================================

  // 本番ボタン → 本番画面へ。3秒後にストップウォッチをスタート
  $("#startPlay").on("click", function () {
    // コンテンツのあるカードがなければ何もしない
    let hasContent = false;

    // コンテンツが入っていることが確認できたらその時点でbreakし、currentCardIdx = 0 以降へ。
    for (let i = 0; i < speech.cards.length; i++) {
      if (speech.cards[i].trigger.trim() && speech.cards[i].outline.trim() && speech.cards[i].keywords.length > 0) {
        hasContent = true;
        break;
      }
    }

    // コンテンツが入ってなければここで終了
    if (!hasContent) return;

    currentCardIdx = 0;
    renderPlay();
    showScreen("Play");

    // 前回のタイマーが残っていればリセット
    clearTimeout(timerTimeout);
    clearInterval(timerInterval);
    timerSeconds = 0;
    $("#timer").text("0:00");

    // 本番カウントスタート
    timerTimeout = setTimeout(function () {
      timerInterval = setInterval(function () {
        timerSeconds++;
        const m = Math.floor(timerSeconds / 60);
        const s = timerSeconds % 60;
        $("#timer").text(m + ":" + (s < 10 ? "0" : "") + s);
      }, 1000);
    }, 100);
  });



  // ===========================================
  // 本番画面
  // ===========================================

  // 現在のカード番号に対応する内容を本番画面に出力し、前へ/次へボタンの活性状態を更新する
  function renderPlay() {

    // コンテンツ（構成メモ、きっかけ、キーワード）が入ったカードだけを対象にして、配列に格納。
    const list = [];
    for (let i = 0; i < speech.cards.length; i++) {
      const c = speech.cards[i];
      if (c.trigger.trim() && c.outline.trim() && c.keywords.length > 0) {
        list.push(c);
      }
    }

    const total = list.length;

    // コンテンツがなければそこで終了
    if (total === 0) return;


    const c = list[currentCardIdx];

    // 今見ている画面のプログレスバーを更新
    $("#progCur").text(currentCardIdx + 1);
    $("#progTotal").text(total);
    $("#progFill").css("width", ((currentCardIdx + 1) / total) * 100 + "%");

    // 今見ている画面のHTMLの変数を設定
    let kwHtml = "";

    // まず、今見ているカードのキーワードを出力
    for (let i = 0; i < c.keywords.length; i++) {
      kwHtml += `
      <div class="play-kw">
        <span class="play-kw-num">${String(i + 1).padStart(2, "0")}</span>
        <span class="play-kw-text">${escapeHtml(c.keywords[i])}</span>
      </div>
    `;
    }

    // 今見ているカード内容を出力する
    $("#playArea").html(`
      <div class="play-card">
        
        ${c.outline.trim() ? `<div class="play-outline">${escapeHtml(c.outline)}</div>` : '<div class="play-outline"></div>'}
        ${c.trigger.trim() ? `<div class="play-trigger-label">きっかけ</div><div class="play-trigger">${escapeHtml(c.trigger)}</div>` : ""}
        ${c.keywords.length ? `<div class="play-keywords">${kwHtml}</div>` : ""}
      </div>
    `);

    // もし今見ているカードが端のカードだったら「前へ」「次へ」ボタンを無効化
    $("#prevCard").prop("disabled", currentCardIdx === 0);
    $("#nextCard").prop("disabled", currentCardIdx === total - 1);
  }


  // 終了 → タイマーをクリアして編集画面へ戻る
  $("#exitPlay").on("click", function () {
    clearTimeout(timerTimeout);
    clearInterval(timerInterval);
    timerSeconds = 0;
    $("#timer").text("0:00");
    showScreen("Edit");
  });


  // 「前へ」。１ページ目で非活性にする制御はrenderPlay()で設定
  $("#prevCard").on("click", function () {
    currentCardIdx--;
    renderPlay();
  });

  // 「次へ」。最終ページで非活性にする制御はrenderPlay()で設定
  $("#nextCard").on("click", function () {
    currentCardIdx++;
    renderPlay();
  });

  // ===========================================
  // 初期化
  // ===========================================
  
  load();                                    // localStorageからデータを読み込む
  $("#speechTitle").val(speech.title);       // タイトル欄にデータを反映する
  renderEditor();                            // カード一覧を画面に描画する
  updatePlayBtn();                           // 本番ボタンの活性状態を更新する
  showScreen("Edit");                        // 編集画面を表示する
});

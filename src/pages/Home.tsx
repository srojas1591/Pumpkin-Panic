import { useEffect, useRef } from 'react'
import { Candy, Ghost, MoonStar, Pause, Play, RotateCcw, Sparkles, Volume2, VolumeX, Zap } from 'lucide-react'
import { startGame, stopGame } from '@/game/boot'

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    startGame(canvas)
    return () => stopGame()
  }, [])

  return (
    <div id="game-root">
      <canvas id="game-canvas" ref={canvasRef} aria-label="Pumpkin Panic 3D game" />

      <div id="ui-overlay">
        <header id="hud" className="is-hidden" aria-label="Game status">
          <div className="hud-left">
            <div className="mini-brand"><Ghost size={19} /> <span>PUMPKIN PANIC</span></div>
            <div className="hud-stat candy-stat">
              <Candy size={18} />
              <div><span>CANDY</span><strong id="candy-count">0 / 12</strong></div>
            </div>
            <div className="hud-stat">
              <span>SCORE</span><strong id="score-count">000000</strong>
            </div>
          </div>
          <div className="hud-center">
            <div className="timer-label"><MoonStar size={15} /> MOONLIGHT</div>
            <strong id="timer-count">60.0</strong>
            <div className="timer-track"><div id="timer-fill" /></div>
          </div>
          <div className="hud-right">
            <div className="hearts-wrap"><span>SPIRIT</span><div id="hearts" aria-label="3 hearts">♥ ♥ ♥</div></div>
            <button id="pause-btn" className="icon-btn" aria-label="Pause game" title="Pause (Esc)"><Pause size={19} /></button>
            <button id="mute-btn" className="icon-btn" aria-label="Mute audio" title="Mute (M)">
              <Volume2 className="sound-on" size={19} /><VolumeX className="sound-off" size={19} />
            </button>
          </div>
        </header>

        <div id="combo-badge" className="is-hidden"><span>SWEET STREAK</span><strong id="combo-count">×2</strong><div id="combo-track"><i id="combo-fill" /></div></div>

        <div id="dash-widget" className="is-hidden">
          <div className="dash-copy"><Zap size={15} /><span id="dash-label">DASH READY</span><kbd>SPACE</kbd></div>
          <div className="dash-track"><div id="dash-fill" /></div>
        </div>

        <section id="title-screen" className="screen">
          <div className="title-card">
            <div className="eyebrow"><Sparkles size={14} /> A TINY HALLOWEEN ARCADE GAME</div>
            <h1>PUMPKIN<br /><em>PANIC</em></h1>
            <p className="title-tagline">Little ghost. Big sweet tooth.<br />One very restless graveyard.</p>
            <div className="objective"><Candy size={22} /><div><strong>Collect 12 candies before moonset</strong><span>Dash through monsters. Chain pickups for a high score.</span></div></div>
            <button id="start-btn" className="primary-btn"><Play size={19} fill="currentColor" /> ENTER THE GRAVEYARD <kbd>SPACE</kbd></button>
            <div className="controls-row">
              <div><kbd>WASD</kbd><span>Move</span></div>
              <div><kbd>SPACE</kbd><span>Dash</span></div>
              <div><kbd>ESC</kbd><span>Pause</span></div>
            </div>
            <div className="best-line">BEST HAUNT <strong id="title-best">000000</strong></div>
          </div>
          <div className="title-tip"><span className="pulse-dot" /> The orange glow means a pumpkin is about to charge.</div>
        </section>

        <section id="pause-screen" className="screen is-hidden">
          <div className="modal-card">
            <div className="eyebrow">TAKE A BREATHER</div>
            <h2>PAUSED</h2>
            <p>The graveyard will wait. Probably.</p>
            <button id="resume-btn" className="primary-btn"><Play size={18} fill="currentColor" /> RESUME <kbd>ESC</kbd></button>
            <button id="pause-restart-btn" className="secondary-btn"><RotateCcw size={17} /> RESTART RUN</button>
          </div>
        </section>

        <section id="end-screen" className="screen is-hidden">
          <div className="modal-card end-card">
            <div id="end-kicker" className="eyebrow">SUGAR RUSH</div>
            <h2 id="end-title">HAUNT COMPLETE!</h2>
            <p id="end-message">You got the goods and ghosted.</p>
            <div className="results-grid">
              <div><span>SCORE</span><strong id="end-score">000000</strong></div>
              <div><span>BEST</span><strong id="end-best">000000</strong></div>
              <div><span>CANDY</span><strong id="end-candy">12 / 12</strong></div>
            </div>
            <div id="new-best" className="new-best is-hidden">✦ NEW BEST HAUNT ✦</div>
            <button id="restart-btn" className="primary-btn"><RotateCcw size={18} /> HAUNT AGAIN <kbd>SPACE</kbd></button>
            <button id="title-btn" className="secondary-btn">BACK TO TITLE</button>
          </div>
        </section>

        <div id="toast" role="status" aria-live="polite" />
        <div id="damage-flash" />

        <div id="touch-controls" className="is-hidden">
          <div className="touch-stick"><span>DRAG<br />TO MOVE</span><i /></div>
          <button id="dash-btn" aria-label="Dash"><Zap size={26} /><span>DASH</span></button>
        </div>

        <footer id="game-footer"><span>WASD / ARROWS TO MOVE</span><span>SPACE TO DASH</span><span>M TO MUTE</span></footer>
      </div>
    </div>
  )
}

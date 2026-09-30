// HUD: binds the DOM elements declared in index.html and renders live game
// state (health bar, weapon name + ammo, objective text, zone) every frame.
// Provides a transient toast API (showMessage) and a damage vignette that
// flashes when the player is hit.

export class HUD {
  constructor() {
    this.healthFill = document.getElementById('health-fill');
    this.weaponName = document.getElementById('weapon-name');
    this.ammoCount = document.getElementById('ammo-count');
    this.objectiveText = document.getElementById('objective-text');
    this.zoneName = document.getElementById('zone-name');
    this.toast = document.getElementById('message-toast');
    this.crosshair = document.getElementById('crosshair');

    this._toastTimer = null;
    this._vignette = this._ensureVignette();
    this._vignetteT = 0;
  }

  /** Lazily create the damage vignette overlay so index.html stays simple. */
  _ensureVignette() {
    let el = document.getElementById('damage-vignette');
    if (!el) {
      el = document.createElement('div');
      el.id = 'damage-vignette';
      el.style.cssText = [
        'position:fixed',
        'inset:0',
        'pointer-events:none',
        'z-index:18',
        'opacity:0',
        'transition:opacity 0.12s ease-out',
        'box-shadow:inset 0 0 200px 60px rgba(180,20,20,0.85)',
      ].join(';');
      document.body.appendChild(el);
    }
    return el;
  }

  /** Show a transient message. */
  showMessage(text, ms = 2200) {
    if (!this.toast) return;
    this.toast.textContent = text;
    this.toast.classList.remove('hidden');
    if (this._toastTimer) clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      this.toast.classList.add('hidden');
      this._toastTimer = null;
    }, ms);
  }

  /** Flash the red damage vignette. */
  flashDamage() {
    this._vignetteT = 0.5;
    if (this._vignette) this._vignette.style.opacity = '1';
  }

  /**
   * Update the HUD from the current game state.
   * @param {object} s { health, maxHealth, weaponLabel, ammoLabel, isMelee,
   *                      objectiveText, zoneName }
   * @param {number} dt seconds since last frame (for vignette fade)
   */
  update(s, dt = 0) {
    if (this.healthFill && typeof s.health === 'number') {
      const pct = Math.max(0, Math.min(100, (s.health / (s.maxHealth || 100)) * 100));
      this.healthFill.style.width = pct + '%';
    }
    if (this.weaponName && s.weaponLabel != null) {
      this.weaponName.textContent = s.weaponLabel;
    }
    if (this.ammoCount) {
      this.ammoCount.textContent = s.isMelee ? '' : (s.ammoLabel || '');
    }
    if (this.objectiveText && s.objectiveText != null) {
      this.objectiveText.textContent = s.objectiveText;
    }
    if (this.zoneName && s.zoneName != null) {
      this.zoneName.textContent = s.zoneName;
    }

    // Fade the vignette out over time.
    if (this._vignetteT > 0) {
      this._vignetteT = Math.max(0, this._vignetteT - dt);
      if (this._vignette) {
        this._vignette.style.opacity = String(this._vignetteT / 0.5);
      }
    }
  }
}

export default HUD;

export function initializeVolumeControls(player) {
  const volTrack = document.getElementById('volume-track');
  const volBar = document.getElementById('volume-bar');
  const volBtn = document.getElementById('volume-btn');

  let savedVolume = parseFloat(localStorage.getItem('kimo-player-volume'));
  if (isNaN(savedVolume)) savedVolume = 0.8;
  player.audio.volume = savedVolume;

  const updateVolumeUI = () => {
    const vol = player.audio.volume;
    if (volBar) volBar.style.width = `${vol * 100}%`;
    const iconOn = document.querySelector('.icon-volume-on');
    const iconMute = document.querySelector('.icon-volume-mute');
    if (iconOn && iconMute) {
      if (vol === 0) {
        iconOn.style.display = 'none';
        iconMute.style.display = 'block';
      } else {
        iconOn.style.display = 'block';
        iconMute.style.display = 'none';
      }
    }
  };

  updateVolumeUI();
  window.addEventListener('kimo-volume-changed', updateVolumeUI);

  let previousVolume = savedVolume > 0 ? savedVolume : 0.8;

  if (volBtn) {
    volBtn.addEventListener('click', () => {
      if (player.audio.volume > 0) {
        previousVolume = player.audio.volume;
        player.audio.volume = 0;
      } else {
        player.audio.volume = previousVolume;
      }
      localStorage.setItem('kimo-player-volume', player.audio.volume);
      updateVolumeUI();
    });
  }

  if (!volTrack) return;

  let isDraggingVol = false;

  const updateVolumeFromX = (clientX) => {
    const rect = volTrack.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    player.audio.volume = percent;
    localStorage.setItem('kimo-player-volume', percent);
    updateVolumeUI();
  };

  volTrack.addEventListener('mousedown', (e) => {
    isDraggingVol = true;
    volTrack.classList.add('is-dragging');
    updateVolumeFromX(e.clientX);
  });

  document.addEventListener('mousemove', (e) => {
    if (isDraggingVol) {
      updateVolumeFromX(e.clientX);
    }
  });

  document.addEventListener('mouseup', () => {
    if (isDraggingVol) {
      isDraggingVol = false;
      volTrack.classList.remove('is-dragging');
    }
  });

  const handleVolumeWheel = (e) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.04 : -0.04;
    const nextVol = Math.max(0, Math.min(1, player.audio.volume + delta));
    player.audio.volume = nextVol;
    localStorage.setItem('kimo-player-volume', nextVol);
    updateVolumeUI();
  };

  volTrack.addEventListener('wheel', handleVolumeWheel, { passive: false });
  const volumeContainer = document.querySelector('.volume-container');
  if (volumeContainer) {
    volumeContainer.addEventListener('wheel', handleVolumeWheel, { passive: false });
  }
}

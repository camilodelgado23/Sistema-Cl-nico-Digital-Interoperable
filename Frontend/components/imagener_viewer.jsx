import { useState } from 'react'
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch'

export default function ImageViewer({ media }) {
  const [showGradcam, setShowGradcam] = useState(false)
  const [brightness,  setBrightness]  = useState(100)
  const [contrast,    setContrast]    = useState(100)

  const imgUrl     = media?.content?.url
  const gradcamUrl = media?.gradcam_url

  const imgStyle = {
    filter: `brightness(${brightness}%) contrast(${contrast}%)`,
    maxWidth: '100%',
    display: 'block',
    borderRadius: 'var(--radius-md)',
    userSelect: 'none',
  }

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div>
          <span className="badge badge-pending" style={{ marginRight: '0.5rem' }}>
            {media.modality || 'IMG'}
          </span>
          <span className="mono" style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            {media.id?.slice(0, 8)}…
          </span>
        </div>
        {gradcamUrl && (
          <button
            className={`btn btn-ghost`}
            onClick={() => setShowGradcam(v => !v)}
            style={{ fontSize: '0.8125rem', padding: '0.375rem 0.75rem' }}
          >
            {showGradcam ? 'Ocultar Grad-CAM' : 'Ver Grad-CAM'}
          </button>
        )}
      </div>

      {/* Image controls */}
      <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem',
          fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
          <span className="label" style={{ margin: 0 }}>Brillo</span>
          <input type="range" min={20} max={200} value={brightness}
            onChange={e => setBrightness(Number(e.target.value))}
            style={{ width: 100, accentColor: 'var(--cyan)' }} />
          <span className="mono" style={{ minWidth: 36 }}>{brightness}%</span>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem',
          fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
          <span className="label" style={{ margin: 0 }}>Contraste</span>
          <input type="range" min={20} max={200} value={contrast}
            onChange={e => setContrast(Number(e.target.value))}
            style={{ width: 100, accentColor: 'var(--cyan)' }} />
          <span className="mono" style={{ minWidth: 36 }}>{contrast}%</span>
        </label>
      </div>

      {/* Viewer — original vs Grad-CAM side by side */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: showGradcam && gradcamUrl ? '1fr 1fr' : '1fr',
        gap: '1rem',
      }}>
        {/* Original */}
        <div>
          {showGradcam && gradcamUrl && (
            <p className="label" style={{ marginBottom: '0.375rem', textAlign: 'center' }}>Original</p>
          )}
          <div style={{
            background: '#000',
            borderRadius: 'var(--radius-md)',
            overflow: 'hidden',
            border: '1px solid var(--border-subtle)',
            maxHeight: 400,
          }}>
            {imgUrl ? (
              <TransformWrapper limitToBounds={false}>
                {({ zoomIn, zoomOut, resetTransform }) => (
                  <>
                    <div style={{ display: 'flex', gap: '0.375rem', padding: '0.375rem',
                      background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border-subtle)' }}>
                      {[['＋', zoomIn], ['－', zoomOut], ['⟲', resetTransform]].map(([lbl, fn]) => (
                        <button key={lbl} onClick={() => fn()} style={{
                          background: 'var(--bg-base)', border: '1px solid var(--border-subtle)',
                          color: 'var(--text-secondary)', borderRadius: 4, padding: '2px 8px',
                          cursor: 'pointer', fontSize: '0.875rem',
                        }}>{lbl}</button>
                      ))}
                    </div>
                    <TransformComponent>
                      <img src={imgUrl} alt="Imagen médica" style={imgStyle} />
                    </TransformComponent>
                  </>
                )}
              </TransformWrapper>
            ) : (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                Imagen no disponible
              </div>
            )}
          </div>
        </div>

        {/* Grad-CAM */}
        {showGradcam && gradcamUrl && (
          <div>
            <p className="label" style={{ marginBottom: '0.375rem', textAlign: 'center' }}>
              Grad-CAM — Zonas de atención del modelo
            </p>
            <div style={{
              background: '#000',
              borderRadius: 'var(--radius-md)',
              overflow: 'hidden',
              border: '1px solid var(--border-active)',
              maxHeight: 400,
            }}>
              <TransformWrapper limitToBounds={false}>
                {({ zoomIn, zoomOut, resetTransform }) => (
                  <>
                    <div style={{ display: 'flex', gap: '0.375rem', padding: '0.375rem',
                      background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border-subtle)' }}>
                      {[['＋', zoomIn], ['－', zoomOut], ['⟲', resetTransform]].map(([lbl, fn]) => (
                        <button key={lbl} onClick={() => fn()} style={{
                          background: 'var(--bg-base)', border: '1px solid var(--border-subtle)',
                          color: 'var(--text-secondary)', borderRadius: 4, padding: '2px 8px',
                          cursor: 'pointer', fontSize: '0.875rem',
                        }}>{lbl}</button>
                      ))}
                    </div>
                    <TransformComponent>
                      <img src={gradcamUrl} alt="Mapa Grad-CAM" style={imgStyle} />
                    </TransformComponent>
                  </>
                )}
              </TransformWrapper>
            </div>
          </div>
        )}
      </div>

      <p className="disclaimer-ai" role="note">
        ⚠ Imagen de uso clínico interno. No distribuir sin autorización.
      </p>
    </div>
  )
}
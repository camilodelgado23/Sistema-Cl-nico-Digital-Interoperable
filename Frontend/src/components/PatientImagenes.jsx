// frontend/src/components/PatientImages.jsx
// Reemplaza tu componente de imágenes actual con este archivo completo.
// Llama al endpoint con ?presign=true para obtener URLs reales de MinIO.

import { useState, useRef } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

function getAuthHeaders() {
  const token = localStorage.getItem("token");
  return { Authorization: `Bearer ${token}` };
}

export default function PatientImages({ patientId, canUpload = false }) {
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [selected, setSelected] = useState(null); // imagen abierta en visor
  const fileRef = useRef();

  // ── Cargar imágenes con URLs presignadas ───────────────────────────────────
  async function loadImages() {
    setLoading(true);
    setError(null);
    try {
      // CLAVE: ?presign=true genera URLs reales de MinIO válidas 1h
      const r = await fetch(
        `${API}/fhir/Media?subject=${patientId}&presign=true&limit=50`,
        { headers: getAuthHeaders() }
      );
      if (!r.ok) throw new Error(`Error ${r.status}`);
      const data = await r.json();
      setImages(data.entry || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  // Cargar al montar
  useState(() => { loadImages(); }, [patientId]);
  // Truco: usar useEffect real en tu app
  if (loading && images.length === 0) {
    loadImages();
  }

  // ── Subir imagen ───────────────────────────────────────────────────────────
  async function handleUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/jpg"].includes(file.type)) {
      alert("Solo se permiten imágenes JPG o PNG");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      alert("Imagen demasiado grande (máx 10 MB)");
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("patient_id", patientId);
      fd.append("modality", "FUNDUS");
      fd.append("file", file);
      const r = await fetch(`${API}/fhir/Media/upload`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: fd,
      });
      if (!r.ok) {
        const err = await r.json();
        throw new Error(err.detail || "Error al subir");
      }
      await loadImages(); // recargar lista
    } catch (e) {
      alert(`Error subiendo imagen: ${e.message}`);
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  // ── Visor de imagen ────────────────────────────────────────────────────────
  if (selected) {
    return (
      <div style={styles.viewerOverlay}>
        <div style={styles.viewerBox}>
          <div style={styles.viewerHeader}>
            <span style={styles.viewerTitle}>
              {selected.modality} — {selected.id?.substring(0, 8)}...
            </span>
            <button onClick={() => setSelected(null)} style={styles.closeBtn}>✕ Cerrar</button>
          </div>
          <img
            src={selected.presigned_url || selected.content?.url}
            alt="Imagen médica"
            style={styles.viewerImg}
            onError={(e) => { e.target.src = "/placeholder-retina.png"; }}
          />
          <div style={styles.viewerMeta}>
            <span>Modalidad: {selected.modality}</span>
            <span>Fecha: {new Date(selected.createdDateTime).toLocaleDateString("es-CO")}</span>
          </div>
        </div>
      </div>
    );
  }

  // ── Vista principal ────────────────────────────────────────────────────────
  return (
    <div style={styles.container}>
      {/* Header con botón subir */}
      {canUpload && (
        <div style={styles.uploadBar}>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            style={styles.uploadBtn}
          >
            {uploading ? "⏳ Subiendo..." : "📤 Subir imagen (JPG/PNG)"}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png"
            onChange={handleUpload}
            style={{ display: "none" }}
          />
          <span style={styles.hint}>Máx 10 MB · JPG o PNG</span>
        </div>
      )}

      {/* Estado de carga */}
      {loading && <p style={styles.empty}>Cargando imágenes...</p>}
      {error && <p style={styles.errorMsg}>Error: {error}</p>}

      {/* Sin imágenes */}
      {!loading && !error && images.length === 0 && (
        <div style={styles.emptyState}>
          <span style={styles.emptyIcon}>🖼️</span>
          <p style={styles.empty}>Sin imágenes registradas para este paciente</p>
          {canUpload && (
            <p style={styles.hint}>Usa el botón de arriba para subir una imagen de retina</p>
          )}
        </div>
      )}

      {/* Grid de imágenes */}
      {images.length > 0 && (
        <div style={styles.grid}>
          {images.map((img) => {
            const imgUrl = img.presigned_url || img.content?.url;
            return (
              <div
                key={img.id}
                style={styles.card}
                onClick={() => setSelected(img)}
              >
                {imgUrl ? (
                  <img
                    src={imgUrl}
                    alt={img.modality}
                    style={styles.thumbnail}
                    onError={(e) => {
                      e.target.style.display = "none";
                      e.target.nextSibling.style.display = "flex";
                    }}
                  />
                ) : null}
                <div
                  style={{
                    ...styles.thumbnailFallback,
                    display: imgUrl ? "none" : "flex",
                  }}
                >
                  🔍
                </div>
                <div style={styles.cardMeta}>
                  <span style={styles.modality}>{img.modality}</span>
                  <span style={styles.date}>
                    {new Date(img.createdDateTime).toLocaleDateString("es-CO")}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Estilos ──────────────────────────────────────────────────────────────────
const styles = {
  container: { padding: "16px 0" },
  uploadBar: {
    display: "flex", alignItems: "center", gap: 12, marginBottom: 20,
  },
  uploadBtn: {
    background: "#06b6d4", color: "#000", border: "none",
    padding: "8px 16px", borderRadius: 8, cursor: "pointer",
    fontWeight: 500, fontSize: 14,
  },
  hint: { fontSize: 12, color: "#6b7280" },
  emptyState: {
    textAlign: "center", padding: "48px 0",
  },
  emptyIcon: { fontSize: 40 },
  empty: { color: "#6b7280", margin: "8px 0" },
  errorMsg: { color: "#ef4444" },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
    gap: 16,
  },
  card: {
    background: "#1e293b", borderRadius: 10, overflow: "hidden",
    cursor: "pointer", border: "1px solid #334155",
    transition: "border-color 0.2s",
  },
  thumbnail: { width: "100%", height: 160, objectFit: "cover", display: "block" },
  thumbnailFallback: {
    width: "100%", height: 160, alignItems: "center", justifyContent: "center",
    fontSize: 32, background: "#0f172a",
  },
  cardMeta: {
    padding: "8px 12px", display: "flex",
    justifyContent: "space-between", alignItems: "center",
  },
  modality: {
    fontSize: 11, fontWeight: 600, color: "#06b6d4",
    background: "#0e3a4a", padding: "2px 7px", borderRadius: 12,
  },
  date: { fontSize: 11, color: "#94a3b8" },
  // Visor
  viewerOverlay: {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)",
    display: "flex", alignItems: "center", justifyContent: "center",
    zIndex: 1000,
  },
  viewerBox: {
    background: "#0f172a", borderRadius: 12, padding: 24,
    maxWidth: 800, width: "90%", border: "1px solid #334155",
  },
  viewerHeader: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    marginBottom: 16,
  },
  viewerTitle: { color: "#e2e8f0", fontWeight: 600, fontSize: 15 },
  closeBtn: {
    background: "#334155", color: "#e2e8f0", border: "none",
    padding: "6px 14px", borderRadius: 8, cursor: "pointer",
  },
  viewerImg: {
    width: "100%", borderRadius: 8,
    maxHeight: "60vh", objectFit: "contain",
  },
  viewerMeta: {
    display: "flex", gap: 24, marginTop: 12,
    fontSize: 13, color: "#94a3b8",
  },
};
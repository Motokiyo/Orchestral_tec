# Instructions pour Claude Code — PlateauMap

## Contexte rapide

Tu es sur le repo https://github.com/Motokiyo/Orchestral_tec
C'est une app React/Vite mobile-first pour gérer les installations de percussions sur un plateau de concert (EIC / Radio France).

Le fichier CLAUDE.md à la racine contient la spec complète. Lis-le d'abord.

Le code existant est dans src/App.jsx, src/data.js, src/utils.js, src/styles.js.
Les données de démo (4 pièces Francesconi) sont déjà en place.

## BUG CRITIQUE À CORRIGER EN PREMIER

La fonction photo ne marche pas sur mobile. Le problème :
- Le code actuel utilise `navigator.mediaDevices.getUserMedia()` qui nécessite HTTPS + permissions complexes
- Sur mobile c'est fragile et ça plante

**Solution : remplacer par `<input type="file" accept="image/*" capture="environment">`**
- Ça ouvre directement l'appareil photo natif du téléphone
- Pas besoin de permissions
- Marche partout

### Flow photo à implémenter :

1. User ouvre un percu dans une pièce → tape "Photos"
2. Écran PhotoSetup : choisir les zones (défaut: Jardin, Milieu, Cour), modifiable
3. Tape "Commencer"
4. Écran PhotoFlow : pour chaque zone, affiche un gros bouton "📸 Prendre la photo — Jardin"
5. Le bouton déclenche un `<input type="file" accept="image/*" capture="environment">` caché
6. Quand la photo est prise → Canvas charge l'image → applique le watermark (fonction applyWatermark dans utils.js) → sauvegarde le dataUrl
7. Passe à la zone suivante
8. Quand toutes les zones sont faites → va à la galerie
9. Chaque photo dans la galerie a un bouton "Télécharger" qui fait un `<a download>`

### Code de référence pour la capture :

```jsx
// Input caché toujours dans le DOM
<input
  ref={fileInputRef}
  type="file"
  accept="image/*"
  capture="environment"
  onChange={handlePhotoCapture}
  style={{ display: "none" }}
/>
<canvas ref={canvasRef} style={{ display: "none" }} />

// Déclencher la caméra
function triggerCamera() {
  fileInputRef.current?.click();
}

// Traiter la photo
function handlePhotoCapture(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
      
      // Appliquer le watermark (fonction dans utils.js)
      applyWatermark(canvas, ctx, { titre, percuNom, zone, num, total, couleur });
      
      const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
      // Sauvegarder dans le state photos
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
  event.target.value = ""; // Reset pour pouvoir reprendre
}

// Télécharger une photo
function downloadPhoto(photo) {
  const a = document.createElement("a");
  a.href = photo.dataUrl;
  a.download = `${photo.zone}_P${photo.num}.jpg`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
```

## AUTRES AMÉLIORATIONS À FAIRE

### 1. TXT éditable — déjà partiellement en place
- Le composant EditableItem existe mais vérifier qu'il marche
- Tap sur un item = édition inline
- × = supprimer
- Bouton "Ajouter un instrument" en bas de chaque percu
- Export TXT et copier presse-papier doivent fonctionner

### 2. Téléchargement TXT
- La fonction downloadTxt dans utils.js crée un Blob et un lien <a download>
- Vérifier que ça marche sur iOS Safari (parfois il faut ouvrir dans un nouvel onglet)

### 3. Galerie photos
- Grille 2 colonnes
- Bordure couleur barnier
- Filtre par pièce
- Tap = plein écran
- Bouton télécharger sur chaque photo en plein écran

## CONTRAINTES

- PAS de localStorage (ça plante dans certains contextes)
- PAS de roundRect sur Canvas (pas supporté partout) → utiliser fillRect
- clipboard dans un try/catch avec fallback execCommand
- Tout le state en mémoire React
- Mobile-first : tout doit marcher sur iPhone Safari
- Le `<input capture="environment">` et le `<canvas>` doivent être TOUJOURS dans le DOM (pas conditionnels)

## COMMANDES

```bash
npm install
npm run dev      # dev local
npm run build    # build prod
npx vercel       # deploy
```

## POUR TESTER

1. `npm run dev` 
2. Ouvrir sur le téléphone (même réseau WiFi, URL: http://IP:5173)
3. Ou `npx vercel` pour avoir une URL HTTPS (obligatoire pour la caméra sur certains navigateurs)
4. Vérifier : navigation entre les pièces, ouvrir un percu, prendre des photos, voir la galerie, éditer la liste TXT, télécharger le TXT

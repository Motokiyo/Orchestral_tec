// Couleurs barnier standard (ruban adhesif gaffer plateau)
export const BARNIER = {
  rouge:     { hex: "#E53935", bg: "#FFCDD2", name: "Rouge" },
  bleu:      { hex: "#1E88E5", bg: "#BBDEFB", name: "Bleu" },
  vert:      { hex: "#43A047", bg: "#C8E6C9", name: "Vert" },
  jaune:     { hex: "#FDD835", bg: "#FFF9C4", name: "Jaune" },
  orange:    { hex: "#FB8C00", bg: "#FFE0B2", name: "Orange" },
  violet:    { hex: "#8E24AA", bg: "#E1BEE7", name: "Violet" },
  rose:      { hex: "#D81B60", bg: "#F8BBD0", name: "Rose" },
  blanc:     { hex: "#E0E0E0", bg: "#FAFAFA", name: "Blanc" },
  noir:      { hex: "#212121", bg: "#E0E0E0", name: "Noir" },
  gris:      { hex: "#78909C", bg: "#CFD8DC", name: "Gris" },
  marron:    { hex: "#6D4C41", bg: "#D7CCC8", name: "Marron" },
  vertjaune: { hex: "#C0CA33", bg: "#F0F4C3", name: "Vert-jaune" },
};

export const CATEGORIES = [
  "Timbales & Peaux",
  "Claviers",
  "Accessoires",
  "Grosses pièces",
  "Stands & supports",
  "Baguettes & spécial",
];

export const DEMO_CONCERT = {
  id: "demo",
  titre: "Programme Francesconi",
  date: "26 mars 2026",
  lieu: "CMPP",
  orchestre: "Ensemble Intercontemporain",
  chef: "Pascal ROPHÉ",
};

export const DEMO_PIECES = [
  {
    id: "etymo",
    titre: "ETYMO",
    compositeur: "Luca FRANCESCONI",
    duree: "~25'",
    salle: "CMPP",
    chef: "Pascal ROPHÉ",
    date: "26 mars 2026",
    couleur: "rouge",
    percus: [
      {
        id: "p1", nom: "Percu 1",
        items: [
          { cat: "Claviers", nom: "Vibraphone 3 oct" },
          { cat: "Claviers", nom: "Xylophone" },
          { cat: "Claviers", nom: "Glockenspiel" },
          { cat: "Claviers", nom: "Marimba 4,5 oct" },
          { cat: "Grosses pièces", nom: "Tam-tam 100cm" },
        ],
      },
      {
        id: "p2", nom: "Percu 2",
        items: [
          { cat: "Claviers", nom: "Marimba" },
          { cat: "Claviers", nom: "Xylophone" },
          { cat: "Claviers", nom: "Glockenspiel valise" },
          { cat: "Timbales & Peaux", nom: "Paire de bongos" },
          { cat: "Grosses pièces", nom: "Tam-tam grave" },
          { cat: "Accessoires", nom: "Grelots suspendus" },
          { cat: "Timbales & Peaux", nom: "2 Roto-toms graves" },
          { cat: "Accessoires", nom: "Cymbale suspendue" },
        ],
      },
    ],
  },
  {
    id: "ueof",
    titre: "Unexpected End of Formula",
    compositeur: "Luca FRANCESCONI",
    duree: "18'",
    salle: "SdC, PP2",
    chef: "Pascal ROPHÉ",
    date: "26 mars 2026",
    couleur: "bleu",
    percus: [
      {
        id: "p1", nom: "Percu 1",
        items: [
          { cat: "Claviers", nom: "Vibraphone" },
          { cat: "Claviers", nom: "Glockenspiel" },
          { cat: "Grosses pièces", nom: "Tam-tam 100cm" },
        ],
      },
      {
        id: "p2", nom: "Percu 2",
        items: [
          { cat: "Accessoires", nom: "Flûte à coulisse" },
          { cat: "Timbales & Peaux", nom: "4 Timbales n°1 à 4" },
          { cat: "Claviers", nom: "Xylophone" },
          { cat: "Claviers", nom: "Vibraphone" },
          { cat: "Accessoires", nom: "Cymbale" },
          { cat: "Accessoires", nom: "Wood board" },
          { cat: "Accessoires", nom: 'Cymbale chinoise 8"' },
          { cat: "Accessoires", nom: "Cymbale chinoise crash" },
          { cat: "Accessoires", nom: "Triangle" },
          { cat: "Claviers", nom: "3 Cloches tubes (Do3+Ré3+Fa4)" },
          { cat: "Accessoires", nom: "2 oct. de Crotales" },
          { cat: "Timbales & Peaux", nom: '2 Bodhran (17"+20")' },
          { cat: "Accessoires", nom: "SpringDrum (Thunder Tongue)" },
          { cat: "Grosses pièces", nom: "Gong opéra chinois" },
          { cat: "Accessoires", nom: "Sand Blocks" },
          { cat: "Grosses pièces", nom: "Tôle Tonnerre" },
        ],
      },
    ],
  },
  {
    id: "daed",
    titre: "Daedalus II",
    compositeur: "Luca FRANCESCONI",
    duree: "22'",
    salle: "CMPP",
    chef: "Pascal ROPHÉ",
    date: "26 mars 2026",
    couleur: "vert",
    percus: [
      {
        id: "p1", nom: "Percu 1",
        items: [
          { cat: "Claviers", nom: "Vibraphone 3 oct" },
          { cat: "Claviers", nom: "Glockenspiel valise" },
          { cat: "Grosses pièces", nom: "Tam-tam (very low)" },
          { cat: "Accessoires", nom: "Bassine d'eau en métal + brosse métallique" },
        ],
      },
      {
        id: "p2", nom: "Percu 2 (ad lib)",
        items: [
          { cat: "Claviers", nom: "Glockenspiel" },
          { cat: "Accessoires", nom: "Bassine d'eau en métal" },
        ],
      },
    ],
  },
  {
    id: "mosk",
    titre: "Moskow Run",
    compositeur: "Luca Francesconi",
    duree: "11'",
    salle: "SdC",
    chef: "Pascal ROPHÉ",
    date: "26 mars 2026",
    couleur: "jaune",
    percus: [
      {
        id: "p1", nom: "Percu 1",
        items: [
          { cat: "Claviers", nom: "Vibraphone 3 oct" },
          { cat: "Claviers", nom: "Marimba 5 oct" },
        ],
      },
    ],
  },
];

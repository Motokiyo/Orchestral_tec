export const BARNIER = {
  rouge:  { hex: "#E53935", bg: "#FFCDD2", name: "Rouge" },
  bleu:   { hex: "#1E88E5", bg: "#BBDEFB", name: "Bleu" },
  vert:   { hex: "#43A047", bg: "#C8E6C9", name: "Vert" },
  jaune:  { hex: "#FDD835", bg: "#FFF9C4", name: "Jaune" },
  orange: { hex: "#FB8C00", bg: "#FFE0B2", name: "Orange" },
  violet: { hex: "#8E24AA", bg: "#E1BEE7", name: "Violet" },
  rose:   { hex: "#D81B60", bg: "#F8BBD0", name: "Rose" },
  blanc:  { hex: "#9E9E9E", bg: "#F5F5F5", name: "Blanc" },
};

export const CATEGORIES = [
  "Timbales & Peaux",
  "Claviers",
  "Accessoires",
  "Grosses pièces",
  "Stands & supports",
  "Baguettes & spécial",
];

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
];

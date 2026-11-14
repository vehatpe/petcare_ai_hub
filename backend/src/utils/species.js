'use strict';

const SPECIES = [
  { id: 'dog', label: 'Chó' },
  { id: 'cat', label: 'Mèo' },
  { id: 'rabbit', label: 'Thỏ' },
  { id: 'hamster', label: 'Hamster' },
  { id: 'bird', label: 'Chim' },
  { id: 'fish', label: 'Cá' },
  { id: 'reptile', label: 'Bò sát' },
  { id: 'other', label: 'Khác' }
];

const SPECIES_IDS = SPECIES.map((s) => s.id);

const SPECIES_VI = SPECIES.reduce((acc, s) => {
  acc[s.id] = s.label.toLowerCase();
  return acc;
}, {});

module.exports = {
  SPECIES,
  SPECIES_IDS,
  SPECIES_VI
};

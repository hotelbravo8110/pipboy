'use strict';
/*
 * Perks are achievements. Each has a check(ctx) that receives
 * { kind, profile, flight, landing, t } and returns true when earned.
 * `progress(profile)` (optional) returns [current, target] for the UI.
 */

const PERKS = [
  {
    id: 'first_flight', name: 'Out of the Vault', icon: 'door', xp: 100,
    desc: 'Complete your very first logged flight. The skies are no longer a rumour.',
    check: ({ kind, profile }) => kind === 'flightEnd' && profile.flights >= 1,
  },
  {
    id: 'butter', name: 'Butter Fingers', icon: 'butter', xp: 150,
    desc: 'Touch down at less than 60 feet per minute. Passengers asked if you had landed yet.',
    check: ({ kind, landing }) => kind === 'landing' && landing.fpm < 60,
  },
  {
    id: 'smooth_operator', name: 'Smooth Operator', icon: 'wave', xp: 200,
    desc: 'Make 5 landings softer than 120 feet per minute.',
    progress: (p) => [p.smoothLandings || 0, 5],
    check: ({ profile }) => (profile.smoothLandings || 0) >= 5,
  },
  {
    id: 'lead_belly', name: 'Lead Belly', icon: 'anvil', xp: 25,
    desc: 'Survive a landing harder than 600 feet per minute. The gear will be filing a complaint.',
    check: ({ kind, landing }) => kind === 'landing' && landing.fpm > 600,
  },
  {
    id: 'stratosphere', name: 'Stratosphere Strider', icon: 'rocket', xp: 150,
    desc: 'Climb to flight level 350 or higher.',
    check: ({ kind, flight }) => kind === 'tick' && flight && flight.maxAltFt >= 35000,
  },
  {
    id: 'speed_demon', name: 'Speed Demon', icon: 'bolt', xp: 100,
    desc: 'Exceed 450 knots ground speed. Tailwinds count. Nobody has to know.',
    check: ({ kind, t }) => kind === 'tick' && t && t.gs > 450 && !t.onGround,
  },
  {
    id: 'iron_stomach', name: 'Iron Stomach', icon: 'fist', xp: 100,
    desc: 'Pull more than 2.5 G in flight.',
    check: ({ kind, t }) => kind === 'tick' && t && !t.onGround && t.gForce > 2.5,
  },
  {
    id: 'daredevil', name: 'Daredevil', icon: 'skull', xp: 125,
    desc: 'Scream past at more than 150 knots, below 300 feet, gear up.',
    check: ({ kind, t, flight }) => kind === 'tick' && t && !t.onGround && t.aglFt < 300 && t.ias > 150 && t.gear < 0.1 && flight && flight.airborneSec > 30,
  },
  {
    id: 'crosswind', name: 'Crosswind Crusader', icon: 'wind', xp: 150,
    desc: 'Land with a crosswind component above 15 knots.',
    check: ({ kind, landing }) => kind === 'landing' && Math.abs(landing.crosswindKt) > 15,
  },
  {
    id: 'night_owl', name: 'Night Owl', icon: 'moon', xp: 100,
    desc: 'Land after the sun has set. Runway lights are your friends.',
    check: ({ kind, landing }) => kind === 'landing' && landing.night,
  },
  {
    id: 'long_hauler', name: 'Long Hauler', icon: 'road', xp: 250,
    desc: 'Fly more than 1000 nautical miles in a single flight.',
    check: ({ kind, flight }) => kind === 'flightEnd' && flight.distanceNm > 1000,
  },
  {
    id: 'marathoner', name: 'Marathoner', icon: 'clock', xp: 250,
    desc: 'Complete a flight lasting more than 4 hours.',
    check: ({ kind, flight }) => kind === 'flightEnd' && flight.durationSec > 4 * 3600,
  },
  {
    id: 'globetrotter', name: 'Globetrotter', icon: 'globe', xp: 300,
    desc: 'Land at 10 different airports.',
    progress: (p) => [(p.airports || []).length, 10],
    check: ({ profile }) => (profile.airports || []).length >= 10,
  },
  {
    id: 'frequent_flyer', name: 'Frequent Flyer', icon: 'ticket', xp: 400,
    desc: 'Complete 25 flights.',
    progress: (p) => [p.flights || 0, 25],
    check: ({ profile }) => (profile.flights || 0) >= 25,
  },
  {
    id: 'touch_and_go', name: 'Bounce Back', icon: 'spring', xp: 75,
    desc: 'Touch down and take off again on the same flight. Practice makes perfect.',
    check: ({ kind, flight }) => kind === 'tick' && flight && flight.touchAndGos >= 1,
  },
  {
    id: 'fumes', name: 'Running on Fumes', icon: 'can', xp: 100,
    desc: 'Land with less than 10% fuel remaining. Living dangerously.',
    check: ({ kind, landing }) => kind === 'landing' && landing.fuelPct !== null && landing.fuelPct < 10 && landing.fuelPct > 0,
  },
  {
    id: 'pathfinder', name: 'Pathfinder', icon: 'flag', xp: 150,
    desc: 'Set a destination on the MAP and land there.',
    check: ({ kind, landing }) => kind === 'landing' && landing.atDestination,
  },
  {
    id: 'robo_pilot', name: 'Robo-Pilot', icon: 'robot', xp: 100,
    desc: 'Let the autopilot do the work for a full hour on one flight.',
    check: ({ kind, flight }) => kind === 'tick' && flight && flight.apSec >= 3600,
  },
  {
    id: 'centurion', name: 'Centurion', icon: 'star', xp: 500,
    desc: 'Log 100 hours of total flight time.',
    progress: (p) => [Math.floor((p.airborneSec || 0) / 3600), 100],
    check: ({ profile }) => (profile.airborneSec || 0) >= 100 * 3600,
  },
];

/** Total XP required to reach a level (level 1 = 0 XP). */
function xpForLevel(level) {
  return 100 * ((level - 1) * level) / 2;
}

function levelForXp(xp) {
  let l = 1;
  while (xpForLevel(l + 1) <= xp) l++;
  return l;
}

module.exports = { PERKS, xpForLevel, levelForXp };

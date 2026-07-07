import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Papa from 'papaparse';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import './RailwayMap.css';

const REGION_BOUNDS = {
  minLat: 51.515905,
  maxLat: 58.278014,
  minLng: 71.261348,
  maxLng: 88.021917
};

const colorPalette = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD',
  '#98D8C8', '#F7D794', '#F3A683', '#778beb', '#e77f67', '#63cdda',
  '#f5cd79', '#ea868f', '#596275', '#f7b731', '#786fa6', '#f3a683'
];

const riskColors = {
  critical: '#FF0000',
  high: '#FF4500',
  medium: '#FFA500',
  low: '#FFD700',
  minimal: '#90EE90'
};

const HEATMAP_MATCH_DISTANCE_METERS = 25000;
const HEATMAP_COLOR_LEVELS = 12;
const REGION_CENTER_LAT = (REGION_BOUNDS.minLat + REGION_BOUNDS.maxLat) / 2;

const heatmapStops = [
  { value: 0, color: '#466a92' },
  { value: 0.25, color: '#39a0a2' },
  { value: 0.5, color: '#d5a033' },
  { value: 0.75, color: '#d66b3d' },
  { value: 1, color: '#b83c3c' }
];

const YANDEX_MAPS_SCRIPT_ID = 'yandex-maps-api';
const YANDEX_MAPS_SRC = 'https://api-maps.yandex.ru/2.1/?apikey=d07e771d-d1d0-4fef-bce2-cddd2f2dd789&lang=ru_RU';

const emptyMapData = {
  allStations: [],
  geojsonLines: [],
  failuresData: [],
  availableDevices: []
};

const normalizeStationName = (value) => (
  String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[«»"'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
);

const projectPointToMeters = (lat, lng) => {
  const latMeters = lat * 110540;
  const lngMeters = lng * 111320 * Math.cos((REGION_CENTER_LAT * Math.PI) / 180);
  return { x: lngMeters, y: latMeters };
};

const getDistanceToSegmentMeters = (point, start, end) => {
  const p = projectPointToMeters(point[0], point[1]);
  const a = projectPointToMeters(start[0], start[1]);
  const b = projectPointToMeters(end[0], end[1]);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared === 0) {
    return Math.hypot(p.x - a.x, p.y - a.y);
  }

  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  const closest = {
    x: a.x + t * dx,
    y: a.y + t * dy
  };

  return Math.hypot(p.x - closest.x, p.y - closest.y);
};

const hexToRgb = (hex) => {
  const normalized = hex.replace('#', '');
  return {
    r: parseInt(normalized.slice(0, 2), 16),
    g: parseInt(normalized.slice(2, 4), 16),
    b: parseInt(normalized.slice(4, 6), 16)
  };
};

const rgbToHex = ({ r, g, b }) => (
  `#${[r, g, b].map((value) => Math.round(value).toString(16).padStart(2, '0')).join('')}`
);

const getSteppedHeatmapColor = (count, maxCount) => {
  if (!count || maxCount <= 0) return heatmapStops[0].color;

  const rawRatio = Math.min(count / maxCount, 1);
  const ratio = Math.max(
    1 / (HEATMAP_COLOR_LEVELS - 1),
    Math.ceil(rawRatio * (HEATMAP_COLOR_LEVELS - 1)) / (HEATMAP_COLOR_LEVELS - 1)
  );
  const nextStopIndex = heatmapStops.findIndex((stop) => stop.value >= ratio);
  const upper = heatmapStops[nextStopIndex] || heatmapStops[heatmapStops.length - 1];
  const lower = heatmapStops[Math.max(nextStopIndex - 1, 0)];
  const range = upper.value - lower.value || 1;
  const localRatio = (ratio - lower.value) / range;
  const from = hexToRgb(lower.color);
  const to = hexToRgb(upper.color);

  return rgbToHex({
    r: from.r + (to.r - from.r) * localRatio,
    g: from.g + (to.g - from.g) * localRatio,
    b: from.b + (to.b - from.b) * localRatio
  });
};

import { registerLocale } from 'react-datepicker';
import ru from 'date-fns/locale/ru';
registerLocale('ru', ru);

const RailwayMap = ({ mapData, onMapDataChange }) => {
  const [map, setMap] = useState(null);
  const [currentMapType, setCurrentMapType] = useState('scheme');
  const [fallbackMapData, setFallbackMapData] = useState(emptyMapData);

  const activeMapData = mapData ?? fallbackMapData;
  const { allStations, geojsonLines, failuresData, availableDevices } = activeMapData;

  const updateMapData = useCallback((patch) => {
    if (onMapDataChange) {
      onMapDataChange(patch);
      return;
    }

    setFallbackMapData((prev) => ({ ...prev, ...patch }));
  }, [onMapDataChange]);

  const [selectedDate, setSelectedDate] = useState(null);
  const [dateRange, setDateRange] = useState({ start: null, end: null });
  const [filterMode, setFilterMode] = useState('single');
  const [filteredFailures, setFilteredFailures] = useState([]);
  
  const [selectedMonths, setSelectedMonths] = useState([]);
  const [selectedQuarters, setSelectedQuarters] = useState([]);
  
  const [selectedDevices, setSelectedDevices] = useState(new Set());
  const [showDeviceFilter, setShowDeviceFilter] = useState(false);
  const [selectedRiskLevel, setSelectedRiskLevel] = useState(null);
  const [showRiskFilter, setShowRiskFilter] = useState(false);
  
  const [selectedShch, setSelectedShch] = useState(new Set());
  const [selectedStations, setSelectedStations] = useState(new Set());
  const [showGeojsonFlag, setShowGeojsonFlag] = useState(true);
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [stationSearch, setStationSearch] = useState('');
  const [status, setStatus] = useState({ message: 'Загрузите исходные файлы для отображения данных', isError: false });
  const [progress, setProgress] = useState({ show: false, percent: 0 });
  
  const [selectedStationDetails, setSelectedStationDetails] = useState(null);
  const [stationFailuresHistory, setStationFailuresHistory] = useState([]);
  
  const shchColors = useRef({});
  const colorIndex = useRef(0);
  
  const stationPlacemarks = useRef([]);
  const geojsonLineObjects = useRef([]);
  const failurePlacemarks = useRef([]);
  
  const isMapReady = useRef(false);
  const mapInitialized = useRef(false);

  const isPointInRegion = useCallback((lat, lng) => {
    return lat >= REGION_BOUNDS.minLat && lat <= REGION_BOUNDS.maxLat &&
           lng >= REGION_BOUNDS.minLng && lng <= REGION_BOUNDS.maxLng;
  }, []);

  const getRiskLevel = useCallback((device) => {
    const text = (device || '').toLowerCase();
    if (text.includes('стрелка') || text.includes('светофор') || text.includes('централизация')) return 'high';
    if (text.includes('аппаратура') || text.includes('реле') || text.includes('питание') || text.includes('кабель')) return 'medium';
    if (text.includes('монтаж') || text.includes('настройка')) return 'low';
    if (text.includes('крушение') || text.includes('авария') || text.includes('пожар')) return 'critical';
    return 'minimal';
  }, []);

  const getRiskLevelText = (level) => {
    const levels = {
      critical: 'Критический',
      high: 'Высокий',
      medium: 'Средний',
      low: 'Низкий',
      minimal: 'Минимальный'
    };
    return levels[level] || 'Неизвестный';
  };

  const getRiskColor = (riskLevel) => {
    const colors = {
      critical: '#FF0000',
      high: '#FF4500',
      medium: '#FFA500',
      low: '#FFD700',
      minimal: '#90EE90'
    };
    return colors[riskLevel] || '#FF0000';
  };

  const getColorForShch = useCallback((shch) => {
    if (!shchColors.current[shch]) {
      shchColors.current[shch] = colorPalette[colorIndex.current % colorPalette.length];
      colorIndex.current = (colorIndex.current + 1) % colorPalette.length;
    }
    return shchColors.current[shch];
  }, []);

  const showStatus = useCallback((message, isError = false, duration = 4000) => {
    setStatus({ message, isError });
    setTimeout(() => {
      setStatus(prev => prev.message === message ? { message: prev.message, isError: false } : prev);
    }, duration);
  }, []);

  const showProgress = useCallback((show, percent = 0) => {
    setProgress({ show, percent });
  }, []);

  // Парсинг даты из формата DD.MM.YYYY
  const parseDateFromCSV = useCallback((dateStr) => {
    if (!dateStr) return null;
    const str = String(dateStr).trim();
    const match = str.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
    if (match) {
      const day = parseInt(match[1], 10);
      const month = parseInt(match[2], 10);
      const year = parseInt(match[3], 10);
      return { year, month, day, dateStr: `${day}.${month}.${year}` };
    }
    console.warn('Не удалось распарсить дату:', dateStr);
    return null;
  }, []);

  const getFailurePoint = useCallback((failure) => {
    const failureStation = normalizeStationName(failure.station);
    const station = failureStation
      ? allStations.find((item) => {
          const stationName = normalizeStationName(item.name);
          return stationName === failureStation ||
            stationName.includes(failureStation) ||
            failureStation.includes(stationName);
        })
      : null;

    if (station) {
      return [Number(station.lat), Number(station.lng)];
    }

    const lat = Number(failure.lat);
    const lng = Number(failure.lng);
    return Number.isFinite(lat) && Number.isFinite(lng) && isPointInRegion(lat, lng)
      ? [lat, lng]
      : null;
  }, [allStations, isPointInRegion]);

  const calculateSegmentFailures = useCallback(() => {
    const counts = new Map();
    
    if (geojsonLines.length === 0 || filteredFailures.length === 0) return counts;
    
    filteredFailures.forEach(failure => {
      const failurePoint = getFailurePoint(failure);
      if (!failurePoint) return;
      
      let minDistance = Infinity;
      let closestKey = null;
      
      geojsonLines.forEach((line, lineIdx) => {
        for (let i = 0; i < line.points.length - 1; i++) {
          const p1 = line.points[i];
          const p2 = line.points[i + 1];
          const distance = getDistanceToSegmentMeters(failurePoint, p1, p2);
          
          if (distance < minDistance && distance <= HEATMAP_MATCH_DISTANCE_METERS) {
            minDistance = distance;
            closestKey = `${lineIdx}_${i}`;
          }
        }
      });
      
      if (closestKey) {
        counts.set(closestKey, (counts.get(closestKey) || 0) + 1);
      }
    });
    
    return counts;
  }, [geojsonLines, filteredFailures, getFailurePoint]);

  // ИСПРАВЛЕННАЯ ФУНКЦИЯ: теперь использует filteredFailures
  const showStationDetails = useCallback((stationName) => {
    let station = allStations.find(s => s.name === stationName);
    if (!station) {
      station = allStations.find(s => s.name.toLowerCase() === stationName.toLowerCase());
    }
    if (!station) {
      station = allStations.find(s => s.name.toLowerCase().includes(stationName.toLowerCase()) || 
                                   stationName.toLowerCase().includes(s.name.toLowerCase()));
    }
    
    if (!station) {
      showStatus(`Станция "${stationName}" не найдена в базе`, true, 3000);
      return;
    }
    
    // Берём отказы из ОТФИЛЬТРОВАННОГО списка
    const stationFailures = filteredFailures.filter(f => {
      if (!f.station) return false;
      const fStation = f.station.toLowerCase();
      const sName = station.name.toLowerCase();
      return fStation.includes(sName) || sName.includes(fStation);
    });
    
    const sortedFailures = [...stationFailures].sort((a, b) => {
      if (!a.parsedDate || !b.parsedDate) return 0;
      return b.parsedDate.year - a.parsedDate.year || 
             b.parsedDate.month - a.parsedDate.month || 
             b.parsedDate.day - a.parsedDate.day;
    });
    
    setStationFailuresHistory(sortedFailures);
    setSelectedStationDetails(station);
  }, [allStations, filteredFailures, showStatus]);

  const closeStationDetails = () => {
    setSelectedStationDetails(null);
    setStationFailuresHistory([]);
  };

  useEffect(() => {
    window.showStationDetails = (stationName) => {
      setTimeout(() => showStationDetails(stationName), 0);
    };
    return () => {
      delete window.showStationDetails;
    };
  }, [showStationDetails]);

  const clearStations = useCallback(() => {
    if (!map) return;
    if (stationPlacemarks.current.length > 0) {
      stationPlacemarks.current.forEach(p => map.geoObjects.remove(p));
      stationPlacemarks.current = [];
    }
  }, [map]);

  const clearGeojsonLines = useCallback(() => {
    if (!map) return;
    if (geojsonLineObjects.current.length > 0) {
      geojsonLineObjects.current.forEach(l => map.geoObjects.remove(l));
      geojsonLineObjects.current = [];
    }
  }, [map]);

  const clearFailures = useCallback(() => {
    if (!map) return;
    if (failurePlacemarks.current.length > 0) {
      failurePlacemarks.current.forEach(p => map.geoObjects.remove(p));
      failurePlacemarks.current = [];
    }
  }, [map]);

  const renderStations = useCallback(() => {
    if (!map || allStations.length === 0) return;
    
    clearStations();

    const filteredStations = allStations.filter(station => {
      if (selectedShch.size > 0 && !selectedShch.has(station.shch)) return false;
      if (selectedStations.size > 0 && !selectedStations.has(station.name)) return false;
      return true;
    });
    
    filteredStations.forEach(station => {
      const color = getColorForShch(station.shch);
      const placemark = new window.ymaps.Placemark([station.lat, station.lng], {
        balloonContent: `
          <div style="max-width: 350px;">
            <b style="font-size: 14px;">${station.name}</b><br>
            <span style="color: ${color}">●</span> Участок: ${station.shch}<br>
            Координаты: ${station.lat.toFixed(4)}, ${station.lng.toFixed(4)}<br>
            <hr style="margin: 8px 0;">
            <button 
              onclick="window.showStationDetails('${station.name.replace(/'/g, "\\'")}')" 
              style="width: 100%; padding: 8px; background: #3b82f6; border: none; border-radius: 6px; color: white; cursor: pointer; font-size: 12px; margin-top: 5px;">
              Открыть сведения по станции
            </button>
          </div>
        `,
        hintContent: station.name
      }, {
        preset: 'islands#circleIcon',
        iconColor: color,
        iconContent: ''
      });
      map.geoObjects.add(placemark);
      stationPlacemarks.current.push(placemark);
    });
  }, [map, allStations, selectedShch, selectedStations, getColorForShch, clearStations]);

  const renderGeojsonLines = useCallback(() => {
    if (!map) return;

    clearGeojsonLines();

    if (geojsonLines.length === 0 || !showGeojsonFlag) return;
    
    geojsonLines.forEach((line) => {
      if (selectedShch.size === 0 || selectedShch.has(line.shch)) {
        const basePolyline = new window.ymaps.Polyline(line.points, {
          balloonContent: `
            <b>Маршрут GeoJSON</b><br>
            Участок: ${line.shch}
          `,
          hintContent: `Маршрут GeoJSON`
        }, {
          strokeColor: '#2563eb',
          strokeWidth: 4,
          strokeOpacity: 0.82
        });

        map.geoObjects.add(basePolyline);
        geojsonLineObjects.current.push(basePolyline);
      }
    });
  }, [map, geojsonLines, showGeojsonFlag, selectedShch, clearGeojsonLines]);

  const renderFailures = useCallback(() => {
    if (!map) return;
    
    clearFailures();
    
    if (filteredFailures.length === 0) return;
    
    const failuresByStation = new Map();
    
    filteredFailures.forEach(failure => {
      const station = allStations.find(s => 
        s.name.toLowerCase().includes(failure.station?.toLowerCase()) ||
        failure.station?.toLowerCase().includes(s.name.toLowerCase())
      );
      const stationName = station ? station.name : failure.station;
      if (!failuresByStation.has(stationName)) {
        failuresByStation.set(stationName, []);
      }
      failuresByStation.get(stationName).push(failure);
    });
    
    failuresByStation.forEach((failures, stationName) => {
      const station = allStations.find(s => s.name === stationName);
      let lat, lng;
      
      if (station) {
        lat = station.lat;
        lng = station.lng;
      } else if (failures[0].lat && failures[0].lng) {
        lat = failures[0].lat;
        lng = failures[0].lng;
      } else {
        return;
      }
      
      const maxRiskLevel = failures.reduce((max, f) => {
        const risk = getRiskLevel(f.device);
        const riskOrder = { critical: 5, high: 4, medium: 3, low: 2, minimal: 1 };
        return riskOrder[risk] > (riskOrder[max] || 0) ? risk : max;
      }, 'minimal');
      
      const uniqueDevices = [...new Set(failures.map(f => f.device).filter(d => d && d !== 'Не указано'))];
      const riskColor = getRiskColor(maxRiskLevel);
      
      const placemark = new window.ymaps.Placemark([lat, lng], {
        balloonContent: `
          <div class="map-balloon">
            <div class="map-balloon__title">Отказы на станции ${stationName}</div>
            <div class="map-balloon__meta">
              <div><b>Всего отказов:</b> ${failures.length}</div>
              <div><b>Уровень риска:</b> ${getRiskLevelText(maxRiskLevel)}</div>
              <div><b>Устройства:</b> ${uniqueDevices.slice(0, 5).join(', ')}${uniqueDevices.length > 5 ? '...' : ''}</div>
              <div><b>Подразделение:</b> ${failures[0]?.department || 'Не указано'}</div>
            </div>
            <details open>
              <summary class="map-balloon__summary">Список отказов (${failures.length})</summary>
              <div class="map-balloon__failures">
                ${failures.slice(0, 50).map(f => `
                  <div class="map-balloon__failure" style="border-left-color: ${riskColors[getRiskLevel(f.device)]};">
                    <div><b>Дата:</b> ${f.originalDateStr || f.dateStr}</div>
                    <div><b>Устройство:</b> ${f.device || 'Не указано'}</div>
                    ${f.department ? `<div><b>Подразделение:</b> ${f.department}</div>` : ''}
                    ${f.duration ? `<div><b>Длительность:</b> ${f.duration} час.</div>` : ''}
                    <div><b>Риск:</b> <span style="color: ${riskColors[getRiskLevel(f.device)]}">${getRiskLevelText(getRiskLevel(f.device))}</span></div>
                  </div>
                `).join('')}
                ${failures.length > 50 ? `<div class="map-balloon__more">... и ещё ${failures.length - 50} отказов</div>` : ''}
              </div>
            </details>
            <button 
              onclick="window.showStationDetails('${stationName.replace(/'/g, "\\'")}')" 
              class="map-balloon__button">
              Открыть полную информацию по станции
            </button>
          </div>
        `,
        hintContent: `${stationName}: ${failures.length} отказов, ${getRiskLevelText(maxRiskLevel)}`
      }, {
        iconLayout: 'default#image',
        iconImageHref: `data:image/svg+xml;base64,${btoa(`
          <svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
            <circle cx="8" cy="8" r="7" fill="${riskColor}" stroke="#FFFFFF" stroke-width="1.5"/>
            <circle cx="8" cy="8" r="3" fill="#FFFFFF" opacity="0.6"/>
          </svg>
        `)}`,
        iconImageSize: [16, 16],
        iconImageOffset: [-8, -8]
      });
      
      map.geoObjects.add(placemark);
      failurePlacemarks.current.push(placemark);
    });
  }, [map, filteredFailures, allStations, getRiskLevel, clearFailures]);

  // Инициализация карты
  useEffect(() => {
    if (mapInitialized.current) return;
    mapInitialized.current = true;

    let disposed = false;
    let mapInstance = null;
    let fitMapToContainer = null;

    const createMap = () => {
      if (disposed || !window.ymaps) return;

      window.ymaps.ready(() => {
        if (disposed) return;

        const mapElement = document.getElementById('map');
        if (!mapElement) {
          console.error('Элемент map не найден');
          return;
        }
        
        const newMap = new window.ymaps.Map('map', {
          center: [(REGION_BOUNDS.minLat + REGION_BOUNDS.maxLat) / 2, 
                   (REGION_BOUNDS.minLng + REGION_BOUNDS.maxLng) / 2],
          zoom: 6,
          controls: ['zoomControl', 'fullscreenControl', 'geolocationControl']
        });
        mapInstance = newMap;
        
        newMap.setBounds([
          [REGION_BOUNDS.minLat, REGION_BOUNDS.minLng],
          [REGION_BOUNDS.maxLat, REGION_BOUNDS.maxLng]
        ], { checkZoomRange: true });
        newMap.setType('yandex#map');

        fitMapToContainer = () => {
          setTimeout(() => {
            newMap.container.fitToViewport();
          }, 120);
        };

        window.addEventListener('resize', fitMapToContainer);
        document.addEventListener('fullscreenchange', fitMapToContainer);
        
        setMap(newMap);
        isMapReady.current = true;
        console.log('Карта успешно создана');
      });
    };

    const handleScriptError = () => {
      console.error('Ошибка загрузки Yandex Maps API');
      showStatus('Ошибка загрузки карты', true);
    };

    if (window.ymaps) {
      createMap();
    } else {
      let script = document.getElementById(YANDEX_MAPS_SCRIPT_ID);

      if (!script) {
        script = document.createElement('script');
        script.id = YANDEX_MAPS_SCRIPT_ID;
        script.src = YANDEX_MAPS_SRC;
        script.async = true;
        script.addEventListener('load', createMap, { once: true });
        script.addEventListener('error', handleScriptError, { once: true });
        document.head.appendChild(script);
      } else {
        script.addEventListener('load', createMap, { once: true });
        script.addEventListener('error', handleScriptError, { once: true });
      }
    }

    return () => {
      disposed = true;
      mapInitialized.current = false;
      isMapReady.current = false;

      if (fitMapToContainer) {
        window.removeEventListener('resize', fitMapToContainer);
        document.removeEventListener('fullscreenchange', fitMapToContainer);
      }

      if (mapInstance) {
        mapInstance.destroy();
      }

      stationPlacemarks.current = [];
      geojsonLineObjects.current = [];
      failurePlacemarks.current = [];
    };
  }, [showStatus]);

  // Отрисовка станций
  useEffect(() => {
    if (map && allStations.length > 0) {
      renderStations();
    }
  }, [map, allStations, selectedShch, selectedStations, renderStations]);

  // Отрисовка GeoJSON линий
  useEffect(() => {
    if (map && geojsonLines.length > 0) {
      renderGeojsonLines();
    }
  }, [map, geojsonLines, showGeojsonFlag, selectedShch, renderGeojsonLines]);

  // Отрисовка отказов
  useEffect(() => {
    if (map) {
      renderFailures();
      if (geojsonLines.length > 0 && showGeojsonFlag) {
        renderGeojsonLines();
      }
    }
  }, [map, filteredFailures, renderFailures, renderGeojsonLines, geojsonLines.length, showGeojsonFlag]);

  // Функция фильтрации (работает с parsedDate)
  const applyDateFilter = useCallback(() => {
    if (failuresData.length === 0) {
      setFilteredFailures([]);
      return;
    }

    let filtered = [...failuresData];

    // Убираем записи без корректной даты
    filtered = filtered.filter(f => f.parsedDate !== null && f.parsedDate !== undefined);

    console.log('=== ПРИМЕНЕНИЕ ФИЛЬТРА ===');
    console.log('Режим:', filterMode);
    console.log('Записей с датой:', filtered.length);

    switch (filterMode) {
      case 'single':
        if (selectedDate) {
          const targetYear = selectedDate.getFullYear();
          const targetMonth = selectedDate.getMonth() + 1;
          const targetDay = selectedDate.getDate();
          filtered = filtered.filter(f => 
            f.parsedDate.year === targetYear &&
            f.parsedDate.month === targetMonth &&
            f.parsedDate.day === targetDay
          );
          console.log('Отфильтровано по дню:', filtered.length);
        }
        break;
      
      case 'range':
      case 'week':
      case 'year':
        if (dateRange.start && dateRange.end) {
          const start = new Date(dateRange.start.getFullYear(), dateRange.start.getMonth(), dateRange.start.getDate());
          const end = new Date(dateRange.end.getFullYear(), dateRange.end.getMonth(), dateRange.end.getDate());
          filtered = filtered.filter(f => {
            const d = new Date(f.parsedDate.year, f.parsedDate.month - 1, f.parsedDate.day);
            return d >= start && d <= end;
          });
          console.log('Отфильтровано по диапазону:', filtered.length);
        }
        break;
      
      case 'month':
        if (selectedMonths.length > 0) {
          filtered = filtered.filter(f => 
            selectedMonths.some(m => f.parsedDate.year === m.year && f.parsedDate.month === m.month + 1)
          );
          console.log('Отфильтровано по месяцам:', filtered.length);
        }
        break;
      
      case 'quarter':
        if (selectedQuarters.length > 0) {
          filtered = filtered.filter(f => {
            const quarter = Math.floor((f.parsedDate.month - 1) / 3);
            return selectedQuarters.some(q => f.parsedDate.year === q.year && quarter === q.quarter);
          });
          console.log('Отфильтровано по кварталам:', filtered.length);
        }
        break;
      
      default:
        break;
    }

    // Фильтр по устройствам
    if (selectedDevices.size > 0) {
      filtered = filtered.filter(failure => {
        if (!failure.device || failure.device === 'Не указано') return false;
        const deviceStr = String(failure.device).toLowerCase();
        return Array.from(selectedDevices).some(device => 
          deviceStr.includes(device.toLowerCase())
        );
      });
    }

    // Фильтр по уровню риска
    if (selectedRiskLevel) {
      filtered = filtered.filter(failure => 
        getRiskLevel(failure.device) === selectedRiskLevel
      );
    }

    setFilteredFailures(filtered);
    showStatus(`Отфильтровано отказов: ${filtered.length}`, false, 2000);
  }, [failuresData, filterMode, selectedDate, dateRange, selectedMonths, selectedQuarters, selectedDevices, selectedRiskLevel, getRiskLevel, showStatus]);

  // Применяем фильтр при изменении
  useEffect(() => {
    applyDateFilter();
  }, [applyDateFilter]);

  const getWeekDates = (date) => {
    if (!date) return { startDate: null, endDate: null };
    
    const selectedDate = new Date(date);
    const dayOfWeek = selectedDate.getDay();
    const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    
    const startDate = new Date(selectedDate);
    startDate.setDate(selectedDate.getDate() - diffToMonday);
    
    const endDate = new Date(startDate);
    endDate.setDate(startDate.getDate() + 6);
    
    return { startDate, endDate };
  };

  const getAvailableYears = () => {
    if (failuresData.length === 0) return [];
    const years = new Set();
    failuresData.forEach(f => {
      if (f.parsedDate) years.add(f.parsedDate.year);
    });
    return Array.from(years).sort();
  };

  const toggleMonth = (year, month) => {
    setSelectedMonths(prev => {
      const exists = prev.some(m => m.year === year && m.month === month);
      if (exists) {
        return prev.filter(m => !(m.year === year && m.month === month));
      } else {
        return [...prev, { year, month }];
      }
    });
  };

  const toggleQuarter = (year, quarter) => {
    setSelectedQuarters(prev => {
      const exists = prev.some(q => q.year === year && q.quarter === quarter);
      if (exists) {
        return prev.filter(q => !(q.year === year && q.quarter === quarter));
      } else {
        return [...prev, { year, quarter }];
      }
    });
  };

  const toggleDevice = (device) => {
    setSelectedDevices(prev => {
      const newSet = new Set(prev);
      if (newSet.has(device)) {
        newSet.delete(device);
      } else {
        newSet.add(device);
      }
      return newSet;
    });
  };

  const clearDeviceFilter = () => {
    setSelectedDevices(new Set());
  };

  const handleSingleDateChange = (date) => {
    setSelectedDate(date);
    setFilterMode('single');
  };

  const handleRangeChange = (dates) => {
    const [start, end] = dates || [null, null];
    setDateRange({ start, end });
    setFilterMode('range');
  };

  const handleWeekSelect = (date) => {
    if (date) {
      const { startDate, endDate } = getWeekDates(date);
      setDateRange({ start: startDate, end: endDate });
      setFilterMode('week');
    }
  };

  const handleYearSelect = (year) => {
    if (year) {
      const startDate = new Date(year, 0, 1);
      const endDate = new Date(year, 11, 31);
      setDateRange({ start: startDate, end: endDate });
      setFilterMode('year');
    }
  };

  const handleAllTimeSelect = () => {
    if (failuresData.length > 0) {
      let minYear = Infinity, maxYear = -Infinity;
      let minMonth = 12, maxMonth = 1;
      let minDay = 31, maxDay = 1;
      
      failuresData.forEach(f => {
        if (f.parsedDate) {
          if (f.parsedDate.year < minYear) {
            minYear = f.parsedDate.year;
            minMonth = f.parsedDate.month;
            minDay = f.parsedDate.day;
          }
          if (f.parsedDate.year > maxYear) {
            maxYear = f.parsedDate.year;
            maxMonth = f.parsedDate.month;
            maxDay = f.parsedDate.day;
          }
        }
      });
      
      const startDate = new Date(minYear, minMonth - 1, minDay);
      const endDate = new Date(maxYear, maxMonth - 1, maxDay);
      setDateRange({ start: startDate, end: endDate });
      setFilterMode('range');
    }
  };

  const clearDateFilter = () => {
    setSelectedDate(null);
    setDateRange({ start: null, end: null });
    setSelectedMonths([]);
    setSelectedQuarters([]);
    setSelectedDevices(new Set());
    setSelectedRiskLevel(null);
    setFilterMode('single');
    setFilteredFailures([]);
    showStatus('Все фильтры сброшены', false, 2000);
  };

  // Загрузка файла отказов
  const handleFailuresFile = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    showStatus(`Загрузка файла ${file.name}...`);
    showProgress(true, 0);

    Papa.parse(file, {
      header: true,
      encoding: "UTF-8",
      skipEmptyLines: true,
      dynamicTyping: true,
      complete: (results) => {
        try {
          const failures = [];
          const devicesSet = new Set();
          const data = results.data;

          if (!data || data.length === 0) throw new Error('Файл пуст');

          // Определяем ключи по точному соответствию (твой файл имеет именно такие)
          const firstRow = data[0];
          const dateKey = 'Дата, время';
          const stationKey = 'Станция';
          const deviceKey = 'Отказавшее тех.средство (по КАС АНТ)';
          const deptKey = 'Струк. подразд.';
          const latKey = 'Широта_x';
          const lngKey = 'Долгота_x';
          const durationKey = 'Про долж.';

          console.log('Используемые ключи:', { dateKey, stationKey, deviceKey });

          data.forEach((row, idx) => {
            let dateTime = row[dateKey] || '';
            let station = row[stationKey] || '';
            let device = row[deviceKey] || '';
            let duration = row[durationKey] || '';
            let department = row[deptKey] || '';
            let lat = row[latKey] || null;
            let lng = row[lngKey] || null;

            if (device && device.trim()) {
              device.split(/[,;]/).forEach(d => {
                const trimmed = d.trim();
                if (trimmed && trimmed.length > 2) devicesSet.add(trimmed);
              });
            }

            const parsedDate = parseDateFromCSV(dateTime);

            let parsedLat = lat ? parseFloat(String(lat).replace(',', '.')) : null;
            let parsedLng = lng ? parseFloat(String(lng).replace(',', '.')) : null;

            if (station && parsedDate) {
              failures.push({
                originalDateStr: String(dateTime),
                dateStr: parsedDate.dateStr,
                parsedDate: parsedDate,
                station: String(station).trim(),
                device: String(device || ''),
                department: String(department || ''),
                duration: String(duration || ''),
                lat: parsedLat,
                lng: parsedLng
              });
            }

            if (idx % 1000 === 0) {
              showProgress(true, (idx / data.length) * 100);
            }
          });

          console.log(`Загружено отказов: ${failures.length}`);
          if (failures.length > 0) {
            console.log('Пример распарсенной даты:', failures[0].parsedDate);
          }

          updateMapData({
            failuresData: failures,
            availableDevices: Array.from(devicesSet).sort()
          });
          showProgress(false);
          showStatus(`Загружено отказов: ${failures.length}`, false, 5000);
        } catch (err) {
          console.error('Ошибка:', err);
          showProgress(false);
          showStatus(`Ошибка: ${err.message}`, true);
        }
      },
      error: (err) => {
        console.error('Ошибка парсинга:', err);
        showProgress(false);
        showStatus('Ошибка при разборе файла', true);
      }
    });
  };

  const handleGeojsonFile = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    showStatus(`Загрузка файла ${file.name}...`);
    showProgress(true, 0);

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = JSON.parse(evt.target.result);
        const newGeojsonLines = [];

        const processCoordinates = (coords) => {
          if (!coords || coords.length === 0) return null;
          let isLngLat = false;
          if (coords.length > 0 && Math.abs(coords[0][0]) <= 180 && Math.abs(coords[0][1]) <= 90) {
            isLngLat = true;
          }
          const result = coords.map(coord => {
            const lat = isLngLat ? coord[1] : coord[0];
            const lng = isLngLat ? coord[0] : coord[1];
            return isPointInRegion(lat, lng) ? [lat, lng] : null;
          }).filter(p => p !== null);
          
          return result.length >= 2 ? result : null;
        };

        if (data.type === 'FeatureCollection') {
          data.features.forEach(feature => {
            if (!feature.geometry) return;

            const addGeojsonLine = (coordinates, suffix = '') => {
              const points = processCoordinates(coordinates);
              if (points && points.length >= 2) {
                newGeojsonLines.push({
                  id: `${feature.properties?.id || feature.properties?.name || newGeojsonLines.length}${suffix}`,
                  points: points,
                  color: '#3b82f6',
                  shch: feature.properties?.shch || 'GeoJSON'
                });
              }
            };

            if (feature.geometry.type === 'LineString') {
              addGeojsonLine(feature.geometry.coordinates);
            }

            if (feature.geometry.type === 'MultiLineString') {
              feature.geometry.coordinates.forEach((coordinates, index) => {
                addGeojsonLine(coordinates, `_${index}`);
              });
            }
          });
        }

        updateMapData({ geojsonLines: newGeojsonLines });
        showProgress(false);
        showStatus(`Загружено GeoJSON линий: ${newGeojsonLines.length}`);
      } catch (err) {
        showProgress(false);
        showStatus(`Ошибка: ${err.message}`, true);
      }
    };
    reader.readAsText(file);
  };

  const handleStationsFile = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    showStatus(`Загрузка файла ${file.name}...`);
    showProgress(true, 10);

    Papa.parse(file, {
      header: true,
      encoding: "UTF-8",
      skipEmptyLines: true,
      dynamicTyping: true,
      complete: (results) => {
        try {
          const stations = [];
          const data = results.data;

          data.forEach((row, idx) => {
            let lat = row.Широта || row.lat || row.Latitude;
            let lng = row.Долгота || row.lon || row.Longitude;
            let name = row.Станция || row.name || row.station;
            let shch = row.ШЧ || row.branch || 'Неизвестно';

            if (lat && lng && !isNaN(lat) && !isNaN(lng) && name && isPointInRegion(lat, lng)) {
              stations.push({ name: String(name), lat, lng, shch: String(shch) });
            }

            if (idx % 100 === 0) {
              showProgress(true, 10 + (idx / data.length) * 80);
            }
          });

          updateMapData({ allStations: stations });
          showProgress(false);
          showStatus(`Загружено станций: ${stations.length}`, false, 3000);
        } catch (err) {
          showProgress(false);
          showStatus(`Ошибка: ${err.message}`, true);
        }
      }
    });
  };

  const switchMapLayer = (type) => {
    if (!map) return;
    map.setType(type === 'scheme' ? 'yandex#map' : 'yandex#satellite');
    setCurrentMapType(type);
  };

  const resetView = () => {
    if (!map) return;
    map.setBounds([
      [REGION_BOUNDS.minLat, REGION_BOUNDS.minLng],
      [REGION_BOUNDS.maxLat, REGION_BOUNDS.maxLng]
    ], { checkZoomRange: true });
    showStatus('Область карты возвращена к региону ЗСЖД');
  };

  const selectAllShch = () => setSelectedShch(new Set(allStations.map(s => s.shch)));
  const clearAllShch = () => setSelectedShch(new Set());
  const selectAllStations = () => setSelectedStations(new Set(allStations.map(s => s.name)));
  const clearAllStations = () => setSelectedStations(new Set());

  const updateFilterPanel = useCallback(() => {
    const shchSet = new Set();
    allStations.forEach(s => shchSet.add(s.shch));
    const shchList = Array.from(shchSet).sort();

    const shchContainer = document.getElementById('shchFilterList');
    if (shchContainer) {
      shchContainer.innerHTML = shchList.map(shch => `
        <div class="filter-item">
          <input type="checkbox" value="${shch}" id="shch_${shch.replace(/\s/g, '_')}" ${selectedShch.has(shch) ? 'checked' : ''}>
          <span class="color-badge" style="background: ${getColorForShch(shch)}"></span>
          <label for="shch_${shch.replace(/\s/g, '_')}">${shch}</label>
          <span style="font-size: 10px; color: #888;">(${allStations.filter(s => s.shch === shch).length})</span>
        </div>
      `).join('');

      shchContainer.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.addEventListener('change', (e) => {
          const shch = e.target.value;
          setSelectedShch(prev => {
            const newSet = new Set(prev);
            if (e.target.checked) newSet.add(shch);
            else newSet.delete(shch);
            return newSet;
          });
        });
      });
    }

    const searchTerm = stationSearch.toLowerCase();
    const filteredStationsForList = allStations.filter(s => 
      s.name.toLowerCase().includes(searchTerm)
    ).sort((a, b) => a.name.localeCompare(b.name));

    const stationContainer = document.getElementById('stationFilterList');
    if (stationContainer) {
      stationContainer.innerHTML = filteredStationsForList.map(station => `
        <div class="filter-item">
          <input type="checkbox" value="${station.name}" id="station_${station.name.replace(/\s/g, '_')}" ${selectedStations.has(station.name) ? 'checked' : ''}>
          <span class="color-badge" style="background: ${getColorForShch(station.shch)}"></span>
          <label for="station_${station.name.replace(/\s/g, '_')}">${station.name}</label>
        </div>
      `).join('');

      stationContainer.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.addEventListener('change', (e) => {
          const stationName = e.target.value;
          setSelectedStations(prev => {
            const newSet = new Set(prev);
            if (e.target.checked) newSet.add(stationName);
            else newSet.delete(stationName);
            return newSet;
          });
        });
      });
    }
  }, [allStations, selectedShch, selectedStations, stationSearch, getColorForShch]);

  useEffect(() => {
    updateFilterPanel();
  }, [allStations, selectedShch, selectedStations, stationSearch, updateFilterPanel]);

  const stats = useMemo(() => ({
    stations: allStations.length,
    geojsonLines: geojsonLines.length,
    failures: failuresData.length,
    devices: availableDevices.length
  }), [allStations.length, geojsonLines.length, failuresData.length, availableDevices.length]);

  return (
    <div className="railway-map">
      <div className="railway-map__header">
        <div className="railway-map__title-block">
          <span className="railway-map__eyebrow">Картографический модуль</span>
          <h1 className="railway-map__title">Западно-Сибирская железная дорога</h1>
        </div>
        <div className="railway-map__controls">
          <label className="railway-map__file-label">
            Станции CSV
            <input type="file" accept=".csv" onChange={handleStationsFile} />
          </label>
          <label className="railway-map__file-label">
            Пути GeoJSON
            <input type="file" accept=".geojson,.json" onChange={handleGeojsonFile} />
          </label>
          <label className="railway-map__file-label railway-map__file-label--failures">
            Отказы CSV
            <input type="file" accept=".csv" onChange={handleFailuresFile} />
          </label>
          <div className="railway-map__layer-switcher">
            <button className={currentMapType === 'scheme' ? 'active' : ''} onClick={() => switchMapLayer('scheme')}>Схема</button>
            <button className={currentMapType === 'satellite' ? 'active' : ''} onClick={() => switchMapLayer('satellite')}>Спутник</button>
          </div>
          <button onClick={() => setShowFilterPanel(!showFilterPanel)}>Фильтры</button>
          <button onClick={resetView}>Сброс вида</button>
        </div>
        <div className="railway-map__legend">
          <span><i className="railway-map__station-marker"></i> Станции</span>
          <span><i className="railway-map__line-color geojson"></i> Тепловая карта путей</span>
          <span><i className="railway-map__failure-marker-critical"></i> Критический</span>
          <span><i className="railway-map__failure-marker-high"></i> Высокий</span>
          <span><i className="railway-map__failure-marker-medium"></i> Средний</span>
          <span><i className="railway-map__failure-marker-low"></i> Низкий</span>
          <span><i className="railway-map__failure-marker-minimal"></i> Минимальный</span>
        </div>
      </div>

      <div className="railway-map__calendar-container">
        <div className="railway-map__calendar-wrapper">
          <div className="railway-map__calendar-tabs">
            <button className={`railway-map__tab-btn ${filterMode === 'single' ? 'active' : ''}`} onClick={() => setFilterMode('single')}>
              Один день
            </button>
            <button className={`railway-map__tab-btn ${filterMode === 'range' ? 'active' : ''}`} onClick={() => setFilterMode('range')}>
              Диапазон
            </button>
            <button className={`railway-map__tab-btn ${['week', 'month', 'quarter', 'year'].includes(filterMode) ? 'active' : ''}`} onClick={() => setFilterMode('week')}>
              Периоды
            </button>
          </div>

          {filterMode === 'single' && (
            <div className="railway-map__date-single">
              <DatePicker
                selected={selectedDate}
                onChange={handleSingleDateChange}
                dateFormat="dd.MM.yyyy"
                placeholderText="Выберите дату"
                className="railway-map__calendar-input"
                isClearable
                showYearDropdown
                locale="ru"
              />
            </div>
          )}

          {filterMode === 'range' && (
            <div className="railway-map__date-range">
              <DatePicker
                selectsRange={true}
                startDate={dateRange.start}
                endDate={dateRange.end}
                onChange={handleRangeChange}
                dateFormat="dd.MM.yyyy"
                placeholderText="Выберите диапазон дат"
                className="railway-map__calendar-input railway-map__calendar-input--range"
                isClearable
                showYearDropdown
                locale="ru"
              />
              <button className="railway-map__all-time-btn" onClick={handleAllTimeSelect}>Весь период</button>
            </div>
          )}

          {filterMode === 'week' && (
            <div className="railway-map__period-selector">
              <div className="railway-map__period-buttons">
                <button className={`railway-map__period-btn ${filterMode === 'week' ? 'active' : ''}`} onClick={() => setFilterMode('week')}>Неделя</button>
                <button className={`railway-map__period-btn ${filterMode === 'month' ? 'active' : ''}`} onClick={() => setFilterMode('month')}>Месяц</button>
                <button className={`railway-map__period-btn ${filterMode === 'quarter' ? 'active' : ''}`} onClick={() => setFilterMode('quarter')}>Квартал</button>
                <button className={`railway-map__period-btn ${filterMode === 'year' ? 'active' : ''}`} onClick={() => setFilterMode('year')}>Год</button>
              </div>
              <DatePicker
                selected={dateRange.start}
                onChange={handleWeekSelect}
                dateFormat="dd.MM.yyyy"
                placeholderText="Выберите любую дату недели"
                className="railway-map__calendar-input"
                locale="ru"
              />
            </div>
          )}

          {filterMode === 'month' && (
            <div className="railway-map__period-selector">
              <div className="railway-map__period-buttons">
                <button className={`railway-map__period-btn ${filterMode === 'week' ? 'active' : ''}`} onClick={() => setFilterMode('week')}>Неделя</button>
                <button className={`railway-map__period-btn ${filterMode === 'month' ? 'active' : ''}`} onClick={() => setFilterMode('month')}>Месяц</button>
                <button className={`railway-map__period-btn ${filterMode === 'quarter' ? 'active' : ''}`} onClick={() => setFilterMode('quarter')}>Квартал</button>
                <button className={`railway-map__period-btn ${filterMode === 'year' ? 'active' : ''}`} onClick={() => setFilterMode('year')}>Год</button>
              </div>
              <div className="railway-map__month-multi-selector">
                <div className="railway-map__multi-select-header">
                  <span>Выберите месяцы (можно несколько):</span>
                  {selectedMonths.length > 0 && (
                    <button className="railway-map__clear-btn-small" onClick={() => setSelectedMonths([])}>Очистить все</button>
                  )}
                </div>
                <div className="railway-map__months-grid">
                  {getAvailableYears().map(year => (
                    <div key={year} className="railway-map__year-group">
                      <div className="railway-map__year-title">{year}</div>
                      <div className="railway-map__months-row">
                        {[0,1,2,3,4,5,6,7,8,9,10,11].map(month => {
                          const isSelected = selectedMonths.some(m => m.year === year && m.month === month);
                          const monthName = new Date(year, month, 1).toLocaleDateString('ru-RU', { month: 'short' });
                          return (
                            <button key={`${year}-${month}`} className={`railway-map__month-btn ${isSelected ? 'active' : ''}`} onClick={() => toggleMonth(year, month)}>
                              {monthName}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {filterMode === 'quarter' && (
            <div className="railway-map__period-selector">
              <div className="railway-map__period-buttons">
                <button className={`railway-map__period-btn ${filterMode === 'week' ? 'active' : ''}`} onClick={() => setFilterMode('week')}>Неделя</button>
                <button className={`railway-map__period-btn ${filterMode === 'month' ? 'active' : ''}`} onClick={() => setFilterMode('month')}>Месяц</button>
                <button className={`railway-map__period-btn ${filterMode === 'quarter' ? 'active' : ''}`} onClick={() => setFilterMode('quarter')}>Квартал</button>
                <button className={`railway-map__period-btn ${filterMode === 'year' ? 'active' : ''}`} onClick={() => setFilterMode('year')}>Год</button>
              </div>
              <div className="railway-map__quarter-multi-selector">
                <div className="railway-map__multi-select-header">
                  <span>Выберите кварталы (можно несколько):</span>
                  {selectedQuarters.length > 0 && (
                    <button className="railway-map__clear-btn-small" onClick={() => setSelectedQuarters([])}>Очистить все</button>
                  )}
                </div>
                <div className="railway-map__quarters-grid">
                  {getAvailableYears().map(year => (
                    <div key={year} className="railway-map__year-group">
                      <div className="railway-map__year-title">{year}</div>
                      <div className="railway-map__quarters-row">
                        {[0,1,2,3].map(quarter => {
                          const isSelected = selectedQuarters.some(q => q.year === year && q.quarter === quarter);
                          const quarterNames = {0:'I',1:'II',2:'III',3:'IV'};
                          return (
                            <button key={`${year}-${quarter}`} className={`railway-map__quarter-btn ${isSelected ? 'active' : ''}`} onClick={() => toggleQuarter(year, quarter)}>
                              {quarterNames[quarter]} квартал
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {filterMode === 'year' && (
            <div className="railway-map__period-selector">
              <div className="railway-map__period-buttons">
                <button className={`railway-map__period-btn ${filterMode === 'week' ? 'active' : ''}`} onClick={() => setFilterMode('week')}>Неделя</button>
                <button className={`railway-map__period-btn ${filterMode === 'month' ? 'active' : ''}`} onClick={() => setFilterMode('month')}>Месяц</button>
                <button className={`railway-map__period-btn ${filterMode === 'quarter' ? 'active' : ''}`} onClick={() => setFilterMode('quarter')}>Квартал</button>
                <button className={`railway-map__period-btn ${filterMode === 'year' ? 'active' : ''}`} onClick={() => setFilterMode('year')}>Год</button>
              </div>
              <select className="railway-map__select" onChange={(e) => handleYearSelect(parseInt(e.target.value))} value={dateRange.start?.getFullYear() || ''}>
                <option value="">Выберите год</option>
                {getAvailableYears().map(year => <option key={year} value={year}>{year}</option>)}
              </select>
            </div>
          )}

          <div className="railway-map__filter-buttons-row">
            <button className="railway-map__clear-all-filters" onClick={clearDateFilter}>
              Сбросить все фильтры
            </button>
            {failuresData.length > 0 && (
              <div className="railway-map__failures-stats">
                Всего: {failuresData.length} | После фильтрации: {filteredFailures.length}
              </div>
            )}
          </div>
        </div>
      </div>

      {availableDevices.length > 0 && (
        <div className="railway-map__filters-row">
          <button className={`railway-map__filter-toggle ${showDeviceFilter ? 'active' : ''}`} onClick={() => { setShowDeviceFilter(!showDeviceFilter); setShowRiskFilter(false); }}>
            Устройства {selectedDevices.size > 0 && <span className="badge">{selectedDevices.size}</span>}
          </button>
          <button className={`railway-map__filter-toggle ${showRiskFilter ? 'active' : ''}`} onClick={() => { setShowRiskFilter(!showRiskFilter); setShowDeviceFilter(false); }}>
            Уровень риска {selectedRiskLevel && <span className="badge">1</span>}
          </button>
        </div>
      )}

      {showDeviceFilter && (
        <div className="railway-map__device-filter-panel">
          <div className="railway-map__device-filter-header">
            <span>Выберите устройства (можно несколько):</span>
            {selectedDevices.size > 0 && <button className="clear-btn" onClick={clearDeviceFilter}>Очистить все</button>}
          </div>
          <div className="railway-map__devices-list">
            {availableDevices.map(device => (
              <button key={device} className={`device-item ${selectedDevices.has(device) ? 'active' : ''}`} onClick={() => toggleDevice(device)}>
                {device.length > 40 ? device.substring(0, 37) + '...' : device}
              </button>
            ))}
          </div>
        </div>
      )}

      {showRiskFilter && (
        <div className="railway-map__risk-filter-panel">
          <div className="railway-map__risk-filter-header">
            <span>Уровень риска:</span>
            {selectedRiskLevel && <button className="clear-btn" onClick={() => setSelectedRiskLevel(null)}>Сбросить</button>}
          </div>
          <div className="railway-map__risk-buttons">
            <button className={`risk-btn critical ${selectedRiskLevel === 'critical' ? 'active' : ''}`} onClick={() => setSelectedRiskLevel('critical')}>Критический</button>
            <button className={`risk-btn high ${selectedRiskLevel === 'high' ? 'active' : ''}`} onClick={() => setSelectedRiskLevel('high')}>Высокий</button>
            <button className={`risk-btn medium ${selectedRiskLevel === 'medium' ? 'active' : ''}`} onClick={() => setSelectedRiskLevel('medium')}>Средний</button>
            <button className={`risk-btn low ${selectedRiskLevel === 'low' ? 'active' : ''}`} onClick={() => setSelectedRiskLevel('low')}>Низкий</button>
            <button className={`risk-btn minimal ${selectedRiskLevel === 'minimal' ? 'active' : ''}`} onClick={() => setSelectedRiskLevel('minimal')}>Минимальный</button>
          </div>
        </div>
      )}

      <div id="map"></div>

      {selectedStationDetails && (
        <div className="railway-map__modal-overlay" onClick={closeStationDetails}>
          <div className="railway-map__modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="railway-map__modal-header">
              <h3>{selectedStationDetails.name}</h3>
              <button className="modal-close" onClick={closeStationDetails}>✕</button>
            </div>
            <div className="railway-map__modal-body">
              <div className="station-info">
                <div className="station-info-grid">
                  <div><strong>Участок:</strong> {selectedStationDetails.shch}</div>
                  <div><strong>Всего отказов:</strong> {stationFailuresHistory.length}</div>
                  <div><strong>Период:</strong> {stationFailuresHistory.length > 0 ? `${stationFailuresHistory[stationFailuresHistory.length-1]?.dateStr} - ${stationFailuresHistory[0]?.dateStr}` : 'Нет данных'}</div>
                  <div><strong>Уникальных устройств:</strong> {new Set(stationFailuresHistory.map(f => f.device).filter(d => d)).size}</div>
                </div>
                {filteredFailures.length !== failuresData.length && (
                  <div style={{ marginTop: '8px', fontSize: '12px', color: '#666', textAlign: 'center' }}>
                    Показаны только отказы, соответствующие текущим фильтрам
                  </div>
                )}
              </div>
              <div className="failures-list">
                <h4>Полная история отказов ({stationFailuresHistory.length})</h4>
                <div className="failures-table-container">
                  <table className="failures-table">
                    <thead>
                      <tr>
                        <th>Дата</th>
                        <th>Устройство</th>
                        <th>Подразделение</th>
                        <th>Длительность</th>
                        <th>Риск</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stationFailuresHistory.map((f, i) => (
                        <tr key={i}>
                          <td>{f.dateStr}</td>
                          <td title={f.device}>{f.device?.substring(0, 50) || '-'}{f.device?.length > 50 ? '...' : ''}</td>
                          <td>{f.department || '-'}</td>
                          <td>{f.duration || '-'}</td>
                          <td><span className={`risk-badge ${getRiskLevel(f.device)}`}>{getRiskLevelText(getRiskLevel(f.device))}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {showFilterPanel && (
        <div className="railway-map__filter-panel">
          <button className="railway-map__close-filter" onClick={() => setShowFilterPanel(false)}>✕</button>
          <h3>Фильтры</h3>
          <div className="railway-map__filter-section">
            <h4>Участки (ШЧ)</h4>
            <div className="railway-map__filter-buttons"><button onClick={selectAllShch}>Выбрать все</button><button onClick={clearAllShch}>Снять все</button></div>
            <div id="shchFilterList" className="railway-map__filter-list"></div>
          </div>
          <div className="railway-map__filter-section">
            <h4>Станции</h4>
            <div className="railway-map__filter-buttons"><button onClick={selectAllStations}>Выбрать все</button><button onClick={clearAllStations}>Снять все</button></div>
            <input type="text" placeholder="Поиск станции..." value={stationSearch} onChange={(e) => setStationSearch(e.target.value)} className="railway-map__station-search" />
            <div id="stationFilterList" className="railway-map__filter-list" style={{ maxHeight: '250px' }}></div>
          </div>
          <div className="railway-map__filter-section">
            <h4>Тип линий</h4>
            <label><input type="checkbox" checked={showGeojsonFlag} onChange={(e) => setShowGeojsonFlag(e.target.checked)} /> Показать маршруты GeoJSON</label>
          </div>
        </div>
      )}

      <div className={`railway-map__status-panel ${status.isError ? 'error' : 'success'}`}>{status.message}</div>
      <div className="railway-map__stats">
        <div className="railway-map__stat-item">
          <span>Станции</span>
          <strong>{stats.stations}</strong>
        </div>
        <div className="railway-map__stat-item">
          <span>Маршруты</span>
          <strong>{stats.geojsonLines}</strong>
        </div>
        <div className="railway-map__stat-item">
          <span>Отказы</span>
          <strong>{stats.failures}</strong>
        </div>
        <div className="railway-map__stat-item">
          <span>Устройства</span>
          <strong>{stats.devices}</strong>
        </div>
      </div>
      {progress.show && <div className="railway-map__progress-bar"><div className="railway-map__progress-fill" style={{ width: `${progress.percent}%` }}></div></div>}
    </div>
  );
};

export default RailwayMap;

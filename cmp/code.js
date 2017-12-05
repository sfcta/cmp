'use strict';

// Must use npm and babel to support IE11/Safari
import 'babel-polyfill';
import 'isomorphic-fetch';
import vueSlider from 'vue-slider-component';
import Cookies from 'js-cookie';

var maplib = require('../jslib/maplib');
let styles = maplib.styles;
let getLegHTML = maplib.getLegHTML;
let getColorFromVal = maplib.getColorFromVal;
let mymap = maplib.sfmap;
mymap.setView([37.768890, -122.440997], 13);

// some important global variables.
const API_SERVER = 'https://api.sfcta.org/api/';
const GEO_VIEW = 'cmp_segments_master';
const VIZ_LIST = ['ALOS', 'TSPD', 'TRLB', 'ATRAT'];
const VIZ_INFO = {
  'ALOS':{  'TXT': 'Auto Level-of-Service (LOS)',
            'VIEW': 'cmp_autotransit',
            'METRIC': 'los_hcm85',
            'METRIC_DESC': 'Level of Service',
            'COLOR_BY_BINS': false,
            'COLORVALS': ['A', 'B', 'C', 'D', 'E', 'F'],
            'COLORS': ['#060', '#9f0', '#ff3', '#f90', '#f60', '#c00'],
            'CHARTINFO': 'AUTO SPEED TREND (MPH):',
            'CHART_PREC': 1,
            'POST_UNITS': '',
  },

  'TSPD':{  'TXT': 'Transit Speed',
            'VIEW': 'cmp_autotransit',
            'METRIC': 'transit_speed',
            'METRIC_DESC': 'Transit Speed (MPH)',
            'COLOR_BY_BINS': true,
            'COLORVALS': [0, 5, 7.5, 10, 12.5, 15],
            'COLORS': ['#ccc', '#c00', '#f60', '#f90', '#ff3', '#9f0', '#060'],
            'CHARTINFO': 'TRANSIT SPEED TREND (MPH):',
            'CHART_PREC': 1,
            'POST_UNITS': '',
  },

  'TRLB':{  'TXT': 'Transit Reliability',
            'VIEW': 'cmp_autotransit',
            'METRIC': 'transit_cv',
            'METRIC_DESC': 'Transit Reliability',
            'COLOR_BY_BINS': true,
            'COLORVALS': [0, 5, 10, 20, 30, 40],
            'COLORS': ['#ccc', '#060', '#9f0', '#ff3', '#f90', '#f60', '#c00'],
            'CHARTINFO': 'TRANSIT RELIABILITY TREND:',
            'CHART_PREC': 1,
            'POST_UNITS': '%',
  },

  'ATRAT':{ 'TXT': 'Auto-Transit Speed Ratio',
            'VIEW': 'cmp_autotransit',
            'METRIC': 'atspd_ratio',
            'METRIC_DESC': 'Auto/Transit Speed',
            'COLOR_BY_BINS': true,
            'COLORVALS': [0, 1, 1.5, 2, 2.5, 3],
            'COLORS': ['#ccc', '#060', '#9f0', '#ff3', '#f90', '#f60', '#c00'],
            'CHARTINFO': 'AUTO/TRANSIT SPEED TREND:',
            'CHART_PREC': 1,
            'POST_UNITS': '',
  },

};
const MISSING_COLOR = '#ccc';

let init_selectedViz = 'ALOS';
let data_view = VIZ_INFO[init_selectedViz]['VIEW'];
let selviz_metric = VIZ_INFO[init_selectedViz]['METRIC'];
let selPeriod = 'AM';
let aggdata_view = 'cmp_aggregate';
let selGeoId;

let geoLayer, mapLegend;
let selMetricData;
let yearData = {};
let longDataCache = {};
let cacheMetricData;
let popHoverSegment, popSelSegment;
let selectedSegment, prevselectedSegment;

function queryServer() {
  cacheMetricData = null;

  let url = API_SERVER + data_view + '?';
  let params = 'year=eq.'+app.sliderValue +
               '&period=eq.'+selPeriod +
               '&select=cmp_segid,' + selviz_metric;
  let data_url = url + params;

  const geo_url = API_SERVER + GEO_VIEW + '?' + 'select=geometry,cmp_segid,cmp_name,cmp_from,cmp_to,direction,length';

  selMetricData = {};

  // Fetch map data
  fetch(data_url).then((resp) => resp.json()).then(function(mapdata) {
      for (let seg in mapdata) {
        selMetricData[mapdata[seg]['cmp_segid']] = mapdata[seg][selviz_metric];
      }
    }).catch(function(error) {
      console.log("mapdata fetch error: "+error);
    });
  // Fetch segments
  fetch(geo_url)
    .then((resp) => resp.json())
    .then(function(jsonData) {
      mapSegments(jsonData);
    }).catch(function(error) {
      console.log("map error: "+error);
    });
  // Fetch aggregate longitudinal cmp data
  if(!longDataCache[app.selectedViz]) {
    longDataCache[app.selectedViz] = {};
    fetch(API_SERVER + aggdata_view + '?viz=eq.' + app.selectedViz +
                                    '&select=fac_typ,period,year,metric')
    .then((resp) => resp.json()).then(function(jsonData) {
      let byYearAM = {};
      let byYearPM = {};
      for (let entry of jsonData) {
        let val = Number(entry.metric).toFixed(VIZ_INFO[app.selectedViz]['CHART_PREC']);
        if (val === 'NaN') continue;
        if (entry.period=='AM'){
          if (!byYearAM[entry.year]) byYearAM[entry.year] = {};
          byYearAM[entry.year][entry.fac_typ] = val;
        } else {
          if (!byYearPM[entry.year]) byYearPM[entry.year] = {};
          byYearPM[entry.year][entry.fac_typ] = val;
        }
      }
      let data = [];
      for (let year in byYearAM) {
        data.push({year:year, art: byYearAM[year]['Arterial'], fwy: byYearAM[year]['Freeway']});
      }
      longDataCache[app.selectedViz]['AM'] = data;
      data = [];
      for (let year in byYearPM) {
        data.push({year:year, art: byYearPM[year]['Arterial'], fwy: byYearPM[year]['Freeway']});
      }
      longDataCache[app.selectedViz]['PM'] = data;
    })
    .then(function(){
      buildChartHtmlFromCmpData();
    }).catch(function(error) {
      console.log("longdata fetch error: "+error);
    });
  } else buildChartHtmlFromCmpData();

  document.getElementById("chartinfo").innerHTML =
    "<h3 style=\"font-size: 22px;\">" + VIZ_INFO[app.selectedViz]['CHARTINFO'] + "</h3>";
}

// hover panel -------------------
let infoPanel = L.control();

infoPanel.onAdd = function (map) {
  // create a div with a class "info"
  this._div = L.DomUtil.create('div', 'info-panel');
  //this.update();
  return this._div;
};

infoPanel.update = function (geo) {

  infoPanel._div.innerHTML = "";
  infoPanel._div.className = 'info-panel';

  if (geo) {
    this._div.innerHTML = "<b>"+geo.cmp_name+" "
       + geo.direction + "-bound</b><br/>"
       + geo.cmp_from + " to " + geo.cmp_to;
  }

  infoPanelTimeout = setTimeout( function () {
    infoPanel._div.className = 'info-panel-hide';
  }, 2000);

};

infoPanel.addTo(mymap);

function mapSegments(cmpsegJson) {

  // add segments to the map by using metric data to color
  // TODO: figure out why PostGIS geojson isn't in exactly the right format.
  for (let segment of cmpsegJson) {
    segment["type"] = "Feature";
    segment["geometry"] = JSON.parse(segment.geometry);
    //update segment json with metric data (to be used to assign color)
    segment["metric"] = selMetricData[segment.cmp_segid]
  }

  if (geoLayer) mymap.removeLayer(geoLayer);
  if (mapLegend) mymap.removeControl(mapLegend);
  if (popSelSegment) popSelSegment.remove();

  geoLayer = L.geoJSON(cmpsegJson, {
    style: styleByMetricColor,
    onEachFeature: function(feature, layer) {
      layer.on({ mouseover: hoverFeature,
                 click : clickedOnFeature,
      });
    },
  });
  geoLayer.addTo(mymap);

  mapLegend = L.control({position: 'bottomright'});
  mapLegend.onAdd = function (map) {
    let div = L.DomUtil.create('div', 'info legend');
    let legHTML = getLegHTML(VIZ_INFO[app.selectedViz]['COLORVALS'],
                    VIZ_INFO[app.selectedViz]['COLORS'],
                    VIZ_INFO[app.selectedViz]['COLOR_BY_BINS'],
                    VIZ_INFO[app.selectedViz]['POST_UNITS']);
    div.innerHTML = '<h4>' + VIZ_INFO[app.selectedViz]['METRIC_DESC'] + '</h4>' + legHTML;

    return div;
  };
  mapLegend.addTo(mymap);
}

function styleByMetricColor(segment) {
  let cmp_id = segment['cmp_segid'];
  let color = getColorFromVal(segment['metric'],
                              VIZ_INFO[app.selectedViz]['COLORVALS'],
                              VIZ_INFO[app.selectedViz]['COLORS'],
                              VIZ_INFO[app.selectedViz]['COLOR_BY_BINS']);
  if (!color) color = MISSING_COLOR;
  return {color: color, weight: 4, opacity: 1.0};
}

let infoPanelTimeout;
let oldHoverTarget;

function hoverFeature(e) {

  clearTimeout(infoPanelTimeout);
  infoPanel.update(e.target.feature);

  // don't do anything else if the feature is already clicked
  if (selGeoId === e.target.feature.cmp_segid) return;

  // return previously-hovered segment to its original color
  if (oldHoverTarget && e.target.feature.cmp_segid != selGeoId) {
    if (oldHoverTarget.feature.cmp_segid != selGeoId) geoLayer.resetStyle(oldHoverTarget);
  }

  let highlightedGeo = e.target;
  highlightedGeo.bringToFront();

  if(highlightedGeo.feature.cmp_segid != selGeoId) {
    highlightedGeo.setStyle(styles.selected);
    oldHoverTarget = e.target;
  }
}


function clickedOnFeature(e) {
  e.target.setStyle(styles.popup);

  let geo = e.target.feature;
  selGeoId = geo.cmp_segid;
  if(selectedSegment){
    if(selectedSegment.feature.cmp_segid != geo.cmp_segid){
      prevselectedSegment = selectedSegment;
      geoLayer.resetStyle(prevselectedSegment);
      selectedSegment = e.target;
    }
  } else {
    selectedSegment = e.target;
  }

  let tmptxt = geo.cmp_name+" "+geo.direction+"-bound";
  document.getElementById("geoinfo").innerHTML = "<h5>" + tmptxt + " [" +
                                    geo.cmp_from + " to " + geo.cmp_to + "]</h5>";

  if (!cacheMetricData) {
    // fetch longitudinal data for selected cmp segment
    let metric_col = selviz_metric;
    if (selviz_metric==VIZ_INFO['ALOS']['METRIC']) metric_col = 'auto_speed';

    let url = API_SERVER + data_view + '?';
    let params = metric_col + '=not.is.null&' + 'select=cmp_segid,period,year,' + metric_col;
    let data_url = url + params;

    fetch(data_url).then((resp) => resp.json()).then(function(jsonData) {
      cacheMetricData = jsonData;
      showSegmentDetails(geo, e.latlng);

    }).catch(function(error) {
        console.log("longitudinal data err: "+error);
    });

  } else {
    showSegmentDetails(geo, e.latlng);
  }
}

function showSegmentDetails(geo, latlng) {
    // Show popup
    let popupText = "<b>"+geo.cmp_name+" "+geo.direction+"-bound</b><br/>" +
                  geo.cmp_from + " to " + geo.cmp_to;

    popSelSegment = L.popup()
                  .setLatLng(latlng)
                  .setContent(popupText)
                  .addTo(mymap);

    // Show chart (filter json results for just the selected segment)
    let segmentData = cacheMetricData.filter(segment => segment['cmp_segid'] === geo.cmp_segid);
    buildChartHtmlFromCmpData(segmentData);

    // Revert to overall chart when no segment selected
    popSelSegment.on("remove", function(e) {
      geoLayer.resetStyle(selectedSegment);
      document.getElementById("geoinfo").innerHTML = "<h5>All Segments Combined</h5>";
      prevselectedSegment = selectedSegment = selGeoId = null;
      buildChartHtmlFromCmpData();
    });
}

function buildChartHtmlFromCmpData(json=null) {
  document.getElementById("longchart").innerHTML = "";

  if(json) {
    let byYear = {};
    let data = [];
    let maxHeight = 0;

    for (let entry of json) {
      let metric_col = selviz_metric;
      if (selviz_metric==VIZ_INFO['ALOS']['METRIC']) metric_col = 'auto_speed';
      let val = Number(entry[metric_col]).toFixed(VIZ_INFO[app.selectedViz]['CHART_PREC']);
      if (val === 'NaN') continue;
      if (!byYear[entry.year]) byYear[entry.year] = {};
      byYear[entry.year][entry.period] = val;
    }
    for (let year in byYear) {
      data.push({year:year, am: byYear[year]['AM'], pm: byYear[year]['PM']});
      if (byYear[year]['AM']) maxHeight = Math.max(maxHeight, byYear[year]['AM'])
      if (byYear[year]['PM']) maxHeight = Math.max(maxHeight, byYear[year]['PM'])
    }

    // scale ymax to either 20 or 60:
    maxHeight = (maxHeight <= 20 ? 20 : 60);

    // use maxHeight for ALOS and TSPD; use auto for other metrics
    let scale = 'auto';
    if (app.selectedViz == 'ALOS' || app.selectedViz == 'TSPD') scale = maxHeight;

    new Morris.Line({
      // ID of the element in which to draw the chart.
      element: 'longchart',
      // Chart data records -- each entry in this array corresponds to a point on
      // the chart.
      data: data,
      // The name of the data record attribute that contains x-values.
      xkey: 'year',
      // A list of names of data record attributes that contain y-values.
      ykeys: ['am', 'pm'],
      // Labels for the ykeys -- will be displayed when you hover over the
      // chart.
      labels: ['AM', 'PM'],
      ymax: scale,
      lineColors: ["#f66","#99f"],
      xLabels: "year",
      xLabelAngle: 45,
      hideHover: true,
      postUnits: VIZ_INFO[app.selectedViz]['POST_UNITS'],
    });

  } else {
    let ykey_tmp,lab_tmp;
    if(app.selectedViz=='ALOS'){
      ykey_tmp = ['art', 'fwy'];
      lab_tmp = ['Arterial', 'Freeway'];
    } else{
      ykey_tmp = ['art',];
      lab_tmp = ['Arterial',];
    }
    new Morris.Line({
      // ID of the element in which to draw the chart.
      element: 'longchart',
      // Chart data records -- each entry in this array corresponds to a point on
      // the chart.
      data: longDataCache[app.selectedViz][selPeriod],
      // The name of the data record attribute that contains x-values.
      xkey: 'year',
      // A list of names of data record attributes that contain y-values.
      ykeys: ykey_tmp,
      // Labels for the ykeys -- will be displayed when you hover over the
      // chart.
      labels: lab_tmp,
      lineColors: ["#f66","#99f"],
      xLabels: "year",
      xLabelAngle: 45,
      hideHover: true,
      gridTextColor: "#aaa",
      postUnits: VIZ_INFO[app.selectedViz]['POST_UNITS'],
      ymax: (app.selectedViz=='TSPD' ? 60 : 'auto'),
    });
  }
}

function pickAM(thing) {
  app.isAMActive = true;
  app.isPMActive = false;
  selPeriod = 'AM';
  queryServer();
}

function pickPM(thing) {
  app.isAMActive = false;
  app.isPMActive = true;
  selPeriod = 'PM';
  queryServer();
}

function sliderChanged(thing) {
  queryServer();
}

function clickViz(chosenviz) {
  app.selectedViz = chosenviz;
  data_view = VIZ_INFO[chosenviz]['VIEW'];
  selviz_metric = VIZ_INFO[chosenviz]['METRIC'];
  queryServer();
}

// fetch the year details in data
function updateSliderData() {
  let yearlist = [];
  fetch(API_SERVER + data_view + '?select=year')
  .then((resp) => resp.json()).then(function(jsonData) {
    for (let entry of jsonData) {
      if (!yearlist.includes(entry.year)) yearlist.push(entry.year);
    }
    yearlist = yearlist.sort();
    app.timeSlider.data = yearlist;
    app.sliderValue = yearlist[yearlist.length-1];
  });
}

// SLIDER ----
let timeSlider = {
          data: [0],
          sliderValue: 0,
          disabled: false,
					width: 'auto',
					height: 3,
					direction: 'horizontal',
					dotSize: 16,
					eventType: 'auto',
					show: true,
					realTime: false,
					tooltip: 'always',
					clickable: true,
					tooltipDir: 'bottom',
					piecewise: true,
          piecewiseLabel: false,
					lazy: false,
					reverse: false,
          speed: 0.25,
          piecewiseStyle: {
            "backgroundColor": "#ccc",
            "visibility": "visible",
            "width": "6px",
            "height": "6px"
          },
          piecewiseActiveStyle: {
            "backgroundColor": "#ccc",
            "visibility": "visible",
            "width": "6px",
            "height": "6px"
          },
          labelStyle: {  "color": "#ccc"},
          labelActiveStyle: {  "color": "#ccc"},
          processStyle: {
            "backgroundColor": "#ffc"
          },
          style: {"marginTop":"0px","marginBottom":"40px"},
          tooltipStyle: {backgroundColor: "#eaae00", borderColor: "#eaae00"},
};


let app = new Vue({
  el: '#panel',
  delimiters: ['${', '}'],
  data: {
    isAMActive: true,
    isPMActive: false,
    sliderValue: 0,
    timeSlider: timeSlider,
    selectedViz:VIZ_LIST[0],
    vizlist: VIZ_LIST,
    vizinfo: VIZ_INFO,
  },
  watch: {
    sliderValue: sliderChanged,
  },
  methods: {
    pickAM: pickAM,
    pickPM: pickPM,
    clickViz: clickViz,
    clickToggleHelp: clickToggleHelp,
  },
  components: {
    vueSlider,
  }
});

// eat some cookies -- so we can hide the help permanently
let cookieShowHelp = Cookies.get('showHelp');
function clickToggleHelp() {
  helpPanel.showHelp = !helpPanel.showHelp;

  // and save it for next time
  if (helpPanel.showHelp) {
    Cookies.remove('showHelp');
  } else {
    Cookies.set('showHelp','false', {expires:365});
  }
}
let helpPanel = new Vue({
  el: '#helpbox',
  data: {
    showHelp: (cookieShowHelp==undefined),
  },
  methods: {
    clickToggleHelp: clickToggleHelp,
  },
  mounted: function () {
    document.addEventListener("keydown", (e) => {
      if (this.showHelp && e.keyCode == 27) {
        clickToggleHelp();
      }
    });
  }}
);

// this to get the year list directly from the database
// so if database view get updated with new data, the slider data will reflect it too
updateSliderData();


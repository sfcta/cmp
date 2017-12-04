'use strict';

// Use npm and babel to support IE11/Safari
import 'babel-polyfill';
import 'isomorphic-fetch';
import vueSlider from 'vue-slider-component';
import vSelect from 'vue-select';
Vue.component('v-select', vSelect);

let api_server = 'http://api.sfcta.org/api/';
const GEO_VIEW = 'taz_boundaries';
const TABLES_VIEW = 'walkskim_tables';
const MISSING_COLOR = '#ccc';
const DISTANCE_BINS = [0, 0.25, 0.5, 1, 5, 20, 50]
const DISTANCE_COLORS = ['#ccc', '#1a9850', '#91cf60', '#d9ef8b', '#ffffbf', '#fee08b', '#fc8d59', '#d73027']
const DEFAULT_ZOOM = 12;

let segmentLayer;
let selectedGeo, popupSegment, hoverColor, popupColor;
let speedCache = {};

let maplib = require('../jslib/maplib');
let mymap = maplib.sfmap;
let iconOrig = maplib.iconOrig;
let iconDest = maplib.iconDest;
let styles = maplib.styles;
let getLegHTML = maplib.getLegHTML;
let geoColorFunc = maplib.colorFunc.distance;
let geoLayer;
let selTAZProps;

mymap.setView([37.77, -122.42], DEFAULT_ZOOM);


function highlightFeature(e) {
  selectedGeo = e.target;
  selectedGeo.setStyle(styles.selected);
  selectedGeo.bringToFront();
  info.update(selectedGeo.feature, selTAZProps, app.dirSel==app.dirOrig? 'otaz' : 'dtaz');
}
function resetHighlight(e) {
  geoLayer.resetStyle(e.target);
  info.update(null,  selTAZProps, app.dirSel==app.dirOrig? 'otaz' : 'dtaz');
}
function clickedOnFeature(e) {
  app.tazSelVal = {'label':e.target.feature.taz.toString(), value:e.target.feature.taz};
}

let info = L.control();
info.onAdd = function (map) {
  this._div = L.DomUtil.create('div', 'info'); // create a div with a class "info"
  this.update();
  return this._div;
};
info.update = function (props, seltaz=['',''], odind) {
  let pref, suff;
  if(odind=='otaz'){
    pref = 'From Origin TAZ: ';
    suff = 'To Destination TAZ: ';
  } else {
    pref = 'To Destination TAZ: ';
    suff = 'From Origin TAZ: ';
  }
  this._div.innerHTML = '<h4>Information</h4>' +  
      '<b>' + pref + seltaz[0] + '</b>, Neighborhood: ' + seltaz[1] + '<br/>' +
      (props ?
      '<b>' + suff + props.taz + '</b>, Neighborhood: ' + props.nhood + '<br/> <b>Distance: ' + props.distance + ' miles</b>'
      : 'Hover over a TAZ');
};
info.addTo(mymap);

let legend = L.control({position: 'bottomright'});
legend.onAdd = function (map) {
  let div = L.DomUtil.create('div', 'info legend')
  div.innerHTML = '<h4>Distance (miles)</h4>' + getLegHTML(DISTANCE_BINS, DISTANCE_COLORS);
  return div;
};
legend.addTo(mymap);

function queryServer() {
  
  let dataurl = api_server + app.tableSelVal.label + '?';
  let urlparams = app.dirSel==app.dirOrig? 'otaz' : 'dtaz';
  urlparams += '=eq.' + app.tazSelVal.value;
  urlparams += '&select=otaz,dtaz,distance';
  dataurl += urlparams;

  // Fetch viz data
  fetch(dataurl)
    .then((resp) => resp.json())
    .then(function(jsonData) {
      addGeoLayer(jsonData);
    })
    .catch(function(error) {
      console.log("err: "+error);
    });
}

let segmentLos = {};

function styleByColorFunc(feat) {
  let color = maplib.getColorByBin(feat.distance, DISTANCE_BINS, DISTANCE_COLORS);
  return {fillColor: color, 
          fillOpacity: 0.65,
          weight: 0.4, 
          opacity: 1.0,
          color: 'black'};
}

function addGeoLayer(jsonData){

  tazVar = app.dirSel==app.dirOrig? 'dtaz' : 'otaz';

  for(let rec in jsonData){
    if(typeof geoFeatures[jsonData[rec][tazVar]] !== 'undefined'){
      geoFeatures[jsonData[rec][tazVar]]['distance'] = jsonData[rec]['distance'];
    }
  }

  if (geoLayer) geoLayer.clearLayers();
  geoLayer = L.geoJSON(Object.values(geoFeatures), {
    style: styleByColorFunc,
    onEachFeature: function(feature, layer) {
      layer.on({
                mouseover: highlightFeature,
                mouseout: resetHighlight,  
                click : clickedOnFeature
      });
    }
  });
  
  geoLayer.addTo(mymap);
  
  
  
  /*

  if (mymap.segmentLayer) {
    selectedSegment = popupSegment = hoverColor = popupColor = null;
    mymap.removeLayer(segmentLayer);
    segmentLayer = null;
  }
  
  
  console.log(jsonData);*/
}


let tazMarker;
let geoFeatures = {};
let geoIds = [];
let tazVar = 'otaz';
// fetch the year details in data
function updateOptionsData() {
  let tazSelOptions = [];
  fetch(api_server + GEO_VIEW + '?select=geometry,taz,centroid,county,nhood').then((resp) => resp.json()).then(function(jsonData) {
    for (let entry of jsonData) {
	  tazSelOptions.push({label:entry.taz.toString(), value:entry.taz});
    
    //add a few attributes for geoJSON mapping
    entry.type = 'Feature';
    entry.geometry = JSON.parse(entry.geometry);
    
    geoFeatures[entry.taz] = entry;
    geoIds.push(entry.taz);
    }
	  app.tazSelOptions = tazSelOptions;
    app.tazSelVal = {'label':'608',value:608};
  });
  
  let tableSelOptions = [];
  fetch(api_server + TABLES_VIEW).then((resp) => resp.json()).then(function(jsonData) {
    for (let entry of jsonData) {
	  tableSelOptions.push({label:entry.table_name});
    }
	  app.tableSelOptions = tableSelOptions;
    app.tableSelVal = tableSelOptions[0];
  });
    
}

// ------

function getTAZCentroid(centroid_txt){
  centroid_txt = centroid_txt.slice(6);
  centroid_txt = centroid_txt.slice(0,-1);
  return centroid_txt.split(" ").map(Number).reverse();
}

function usrOptionChanged(thing) {
  
  // this occurs if an already selected item is selected again
  if(app.tazSelVal===null){
    app.tazSelVal = app.copytazSelVal;
  }
  if(app.tableSelVal===null){
    app.tableSelVal = app.copytableSelVal;
  }

  if(app.tazSelVal && app.tableSelVal){
    if(typeof app.tazSelVal.value !== 'undefined'){
      //make a copies because of a bug in vue-select
      app.copytazSelVal = {value:app.tazSelVal.value, label:app.tazSelVal.label};
      app.copytableSelVal = {label:app.tableSelVal.label};
      
      let cen_coords = getTAZCentroid(geoFeatures[app.tazSelVal.value].centroid);
      if (tazMarker) tazMarker.remove();
      tazMarker = new L.marker(cen_coords, {icon: app.dirSel==app.dirOrig? iconOrig : iconDest}).addTo(mymap);
      mymap.setView(cen_coords, DEFAULT_ZOOM);
      selTAZProps = [app.tazSelVal.label, geoFeatures[app.tazSelVal.value].nhood];
      info.update(null, selTAZProps, app.dirSel==app.dirOrig? 'otaz' : 'dtaz');
      queryServer();
    }
  }
  
}


let app = new Vue({
  el: '#panel',
  data: {
    dirOrig: 'From Origin',
    dirDest: 'To Destination',
    dirSel: 'From Origin',

    tazSelOptions: [],
    tazSelVal: null,
    copytazSelVal: null,
    
    tableSelOptions: [],
    tableSelVal: {label:''},
    copytableSelVal: null,
  },
  watch: {
    tableSelVal: usrOptionChanged,
    tazSelVal: usrOptionChanged,
    dirSel: usrOptionChanged,
  }
});
updateOptionsData();

/* Parc Pilot — photos de modeles de vehicules (libres de droits, Wikimedia Commons / CC).
   SOURCE UNIQUE : la fiche vehicule et les exports lisent la photo via FP.vehPhoto(v).
   - Priorite a la photo choisie manuellement (champ v.photoUrl), geree ailleurs.
   - Sinon, photo generique du MODELE ci-dessous (marque + modele), avec credit (lic + src).
   Ajouter un modele = ajouter une image dans assets/vehicules/ + une ligne ici (cle = MARQUE MODELE normalise). */
(function (global) {
  var PHOTOS = {
  "PEUGEOT 5008": { img: "assets/vehicules/01-peugeot-5008.jpg", lic: "CC BY-SA 2.0", src: "https://commons.wikimedia.org/wiki/File:Peugeot_5008_Allure_2021_-_52540496100.jpg" },
  "BYD SEAL U": { img: "assets/vehicules/02-byd-seal-u.jpg", lic: "CC BY-SA 4.0", src: "https://commons.wikimedia.org/wiki/File:BYD_Seal_U_IAA_2023_1X7A0045.jpg" },
  "DACIA DUSTER": { img: "assets/vehicules/03-dacia-duster.jpg", lic: "CC BY-SA 4.0", src: "https://commons.wikimedia.org/wiki/File:Dacia_Duster_III_IMG_8961.jpg" },
  "HYUNDAI TUCSON": { img: "assets/vehicules/04-hyundai-tucson.jpg", lic: "CC BY-SA 4.0", src: "https://commons.wikimedia.org/wiki/File:Hyundai_Tucson_(NX4)_1X7A0424.jpg" },
  "MG ZS": { img: "assets/vehicules/05-mg-zs-ev.jpg", lic: "CC BY-SA 4.0", src: "https://commons.wikimedia.org/wiki/File:MG_ZS_EV_Facelift_1X7A5867.jpg" },
  "PEUGEOT 3008": { img: "assets/vehicules/06-peugeot-3008.jpg", lic: "CC BY-SA 4.0", src: "https://commons.wikimedia.org/wiki/File:Peugeot_3008_C_DSC_8318.jpg" },
  "HYUNDAI KONA": { img: "assets/vehicules/07-hyundai-kona.jpg", lic: "CC BY-SA 4.0", src: "https://commons.wikimedia.org/wiki/File:Hyundai_Kona_(SX2)_1X7A1646.jpg" },
  "RENAULT KADJAR": { img: "assets/vehicules/08-renault-kadjar.jpg", lic: "CC BY-SA 4.0", src: "https://commons.wikimedia.org/wiki/File:Renault_Kadjar_Filderstadt_1Y7A4842.jpg" },
  "RENAULT TRAFIC": { img: "assets/vehicules/09-renault-trafic.jpg", lic: "CC BY-SA 4.0", src: "https://commons.wikimedia.org/wiki/File:Renault_Trafic_III_buses_Facelift_1X7A7456.jpg" },
  "MERCEDES BENZ EQA": { img: "assets/vehicules/10-mercedes-eqa.jpg", lic: "CC BY-SA 4.0", src: "https://commons.wikimedia.org/wiki/File:Mercedes-Benz_H243_1X7A0092.jpg" },
  "TOYOTA YARIS CROSS": { img: "assets/vehicules/11-toyota-yaris-cross.jpg", lic: "CC BY-SA 4.0", src: "https://commons.wikimedia.org/wiki/File:Toyota_Yaris_Cross_Hybrid_(XP210)_1X7A1846.jpg" },
  "NISSAN QASHQAI": { img: "assets/vehicules/12-nissan-qashqai.jpg", lic: "CC BY-SA 4.0", src: "https://commons.wikimedia.org/wiki/File:Nissan_Qashqai_e-Power_Automesse_Ludwigsburg_2022_1X7A5924.jpg" },
  "NISSAN X TRAIL": { img: "assets/vehicules/13-nissan-xtrail.jpg", lic: "CC BY-SA 4.0", src: "https://commons.wikimedia.org/wiki/File:Nissan_X-Trail_(T33)_1X7A7179.jpg" },
  "IVECO": { img: "assets/vehicules/14-iveco-daily.jpg", lic: "CC0", src: "https://commons.wikimedia.org/wiki/File:Daily_2016_35S16_Kastenwagen.jpg" },
  "DUCATI PANIGALE": { img: "assets/vehicules/15-ducati-panigale.jpg", lic: "CC BY-SA 4.0", src: "https://commons.wikimedia.org/wiki/File:Ducati_Panigale_V2S_2025.jpg" },
  "MERCEDES BENZ CLASSE S": { img: "assets/vehicules/16-mercedes-classe-s.jpg", lic: "CC BY-SA 4.0", src: "https://commons.wikimedia.org/wiki/File:MERCEDES-BENZ_S-CLASS_(W223)_China_(25).jpg" },
  "TOYOTA C HR": { img: "assets/vehicules/17-toyota-chr.jpg", lic: "CC BY-SA 4.0", src: "https://commons.wikimedia.org/wiki/File:Toyota_C-HR_hybrid_II_GR_Sport_1X7A1663.jpg" },
  "BMW X1": { img: "assets/vehicules/18-bmw-x1.jpg", lic: "CC BY-SA 4.0", src: "https://commons.wikimedia.org/wiki/File:BMW_U11_X1_M35i_DSC_9809.jpg" },
  "AUDI Q3": { img: "assets/vehicules/19-audi-q3.jpg", lic: "CC BY-SA 4.0", src: "https://commons.wikimedia.org/wiki/File:Audi_Q3_Sportback_1X7A0175.jpg" },
  "PORSCHE TAYCAN": { img: "assets/vehicules/20-porsche-taycan.jpg", lic: "CC BY-SA 4.0", src: "https://commons.wikimedia.org/wiki/File:Porsche_Taycan_IMG_0041.jpg" },
  "MG MG4": { img: "assets/vehicules/21-mg4-ev.jpg", lic: "CC BY-SA 4.0", src: "https://commons.wikimedia.org/wiki/File:MG4_EV_Automesse_Ludwigsburg_2022_1X7A5870.jpg" },
  "MG MARVEL R": { img: "assets/vehicules/22-mg-marvel-r.jpg", lic: "CC BY-SA 4.0", src: "https://commons.wikimedia.org/wiki/File:MG_Marvel_R_1X7A0397.jpg" },
  "DACIA SPRING": { img: "assets/vehicules/23-dacia-spring.jpg", lic: "CC BY-SA 4.0", src: "https://commons.wikimedia.org/wiki/File:2023_Dacia_Spring_1X7A6327.jpg" },
  "VOLVO XC60": { img: "assets/vehicules/24-volvo-xc60.jpg", lic: "CC BY-SA 4.0", src: "https://commons.wikimedia.org/wiki/File:Volvo_XC60_(SPA)_FL_1X7A0185.jpg" },
  "BYD ATTO 3": { img: "assets/vehicules/25-byd-atto-3.jpg", lic: "CC BY-SA 4.0", src: "https://commons.wikimedia.org/wiki/File:BYD_Atto_3_1X7A6494.jpg" },
  "OPEL VIVARO": { img: "assets/vehicules/26-opel-vivaro.jpg", lic: "CC BY-SA 4.0", src: "https://commons.wikimedia.org/wiki/File:Opel_Vivaro_C_IMG_8239.jpg" },
  "CITROEN JUMPY": { img: "assets/vehicules/27-citroen-jumpy.jpg", lic: "CC BY-SA 4.0", src: "https://commons.wikimedia.org/wiki/File:Citroen_Jumpy_(third_generation)_1X7A0327.jpg" },
  "RENAULT CAPTUR": { img: "assets/vehicules/28-renault-captur.jpg", lic: "CC BY-SA 4.0", src: "https://commons.wikimedia.org/wiki/File:2024_Renault_Captur_II_IMG_9974.jpg" }
  };
  function norm(s){ return (s||"").toString().toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^A-Z0-9]+/g," ").trim(); }
  // Retourne { img, lic, src, modele } pour un vehicule, via sa marque + son modele. null si aucun modele connu.
  function vehPhoto(v){
    if(!v) return null;
    var vk = norm((v.marque||"") + " " + (v.modele||""));
    if(!vk) return null;
    var best=null, bestLen=-1;
    for(var k in PHOTOS){ if(!PHOTOS.hasOwnProperty(k)) continue;
      var match = (vk===k) || vk.indexOf(k+" ")===0 || k.indexOf(vk+" ")===0;
      if(match && k.length>bestLen){ best=k; bestLen=k.length; }
    }
    if(!best) return null;
    var p = PHOTOS[best];
    return { img: p.img, lic: p.lic, src: p.src, modele: best };
  }
  global.FP_VEH_PHOTOS = PHOTOS;
  global.FP = global.FP || {};
  global.FP.vehPhoto = vehPhoto;
})(typeof window!=="undefined"?window:this);

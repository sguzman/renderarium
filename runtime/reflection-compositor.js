function assignStyles(element, styles) {
  Object.assign(element.style, styles);
}

export class ReflectionComposite {
  constructor(host, options = {}) {
    if (!(host instanceof HTMLElement)) {
      throw new TypeError("ReflectionComposite host must be an HTMLElement");
    }

    this.host = host;
    this.options = {
      frameObjectFit: "contain",
      reflectionOpacity: 0.76,
      reflectionFilter: "saturate(.72) brightness(.88) contrast(.9)",
      clip: {
        left: "23%",
        top: "14%",
        width: "54%",
        height: "69%",
        borderRadius: "47% 47% 20% 20% / 12% 12% 7% 7%",
      },
      subject: {
        left: "-42%",
        top: "4%",
        width: "124%",
        height: "96%",
      },
      ...options,
    };

    this.#build();
  }

  #build() {
    this.host.replaceChildren();
    assignStyles(this.host, {
      position: this.host.style.position || "relative",
      overflow: "visible",
    });

    this.frame = document.createElement("img");
    this.frame.alt = "";
    assignStyles(this.frame, {
      position: "absolute",
      inset: "0",
      width: "100%",
      height: "100%",
      objectFit: this.options.frameObjectFit,
      zIndex: "1",
      pointerEvents: "none",
    });

    this.clip = document.createElement("div");
    assignStyles(this.clip, {
      position: "absolute",
      overflow: "hidden",
      zIndex: "2",
      background: "linear-gradient(145deg,#77677f,#51465a)",
      ...this.options.clip,
    });

    this.subjectWrap = document.createElement("div");
    assignStyles(this.subjectWrap, {
      position: "absolute",
      transformOrigin: "50% 78%",
      ...this.options.subject,
    });

    this.subject = document.createElement("img");
    this.subject.alt = "";
    assignStyles(this.subject, {
      width: "100%",
      height: "100%",
      objectFit: "contain",
      transform: "scaleX(-1)",
      opacity: String(this.options.reflectionOpacity),
      filter: this.options.reflectionFilter,
    });

    this.glass = document.createElement("div");
    assignStyles(this.glass, {
      position: "absolute",
      inset: "0",
      zIndex: "3",
      borderRadius: this.options.clip.borderRadius,
      background:
        "linear-gradient(115deg,#fff6 0 5%,transparent 17% 58%,#fff2 69%,transparent 81%)," +
        "radial-gradient(circle at 35% 18%,#ffdbac35,transparent 38%)",
      mixBlendMode: "screen",
      pointerEvents: "none",
    });

    this.subjectWrap.append(this.subject);
    this.clip.append(this.subjectWrap, this.glass);
    this.host.append(this.frame, this.clip);
  }

  setSources({ frameSrc, subjectSrc }) {
    if (frameSrc !== undefined) this.frame.src = frameSrc;
    if (subjectSrc !== undefined) this.subject.src = subjectSrc;
  }

  setReflectionPose(pose = {}) {
    const {
      x = 0,
      y = 0,
      rotation = 0,
      scale = 1,
      opacity,
    } = pose;

    this.subjectWrap.style.transform =
      `translate(${x}px, ${y}px) rotate(${rotation}deg) scale(${scale})`;

    if (opacity !== undefined) {
      this.subject.style.opacity = String(opacity);
    }
  }

  setClipGeometry(geometry = {}) {
    Object.assign(this.options.clip, geometry);
    assignStyles(this.clip, geometry);
    if (geometry.borderRadius) {
      this.glass.style.borderRadius = geometry.borderRadius;
    }
  }

  elements() {
    return {
      host: this.host,
      frame: this.frame,
      clip: this.clip,
      subjectWrap: this.subjectWrap,
      subject: this.subject,
      glass: this.glass,
    };
  }
}

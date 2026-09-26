/** Colorado Mesh logo mark (mountain, sun and signal arcs); decorative, so aria-hidden. */
export function ColoradoMeshMark() {
  return (
    <svg
      className="cm-brand-mark"
      viewBox="0 0 1024 1024"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <linearGradient
          id="cmMarkMtnGrad"
          x1="0"
          y1="0"
          x2="1"
          y2="0"
          gradientUnits="userSpaceOnUse"
          gradientTransform="matrix(510.141384,0,0,227.403089,280.365777,471.821953)"
        >
          <stop offset="0" stopColor="#83ff80" />
          <stop offset="1" stopColor="#101928" />
        </linearGradient>
        <linearGradient
          id="cmMarkArcAlpha"
          x1="0"
          y1="0.5"
          x2="1"
          y2="0.5"
          gradientUnits="objectBoundingBox"
        >
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0.28" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <mask
          id="cmMarkArcMask"
          maskUnits="objectBoundingBox"
          maskContentUnits="objectBoundingBox"
          x="0"
          y="0"
          width="1"
          height="1"
        >
          <rect x="0" y="0" width="1" height="1" fill="url(#cmMarkArcAlpha)" />
        </mask>
      </defs>
      <g>
        <g transform="matrix(1.482714,0,0,2.228662,-282.713188,-686.490072)">
          <path
            d="M248,604C296.733,449.457 436.333,440.225 508.333,440.225"
            fill="none"
            className="cm-brand-mark-stroke"
            strokeWidth="14"
            strokeLinecap="round"
            vectorEffect="nonScalingStroke"
            mask="url(#cmMarkArcMask)"
          />
        </g>
        <g transform="matrix(-1.482714,0,0,2.124862,1291.713188,-642.794439)">
          <path
            d="M248,604C296.733,449.457 436.333,440.225 508.333,440.225"
            fill="none"
            className="cm-brand-mark-stroke"
            strokeWidth="14"
            strokeLinecap="round"
            vectorEffect="nonScalingStroke"
            mask="url(#cmMarkArcMask)"
          />
        </g>
      </g>
      <g transform="matrix(1.550828,0,0,1.550828,-296.433233,-165.128779)">
        <path
          d="M790.245,583.702C790.333,584.309 790.42,584.916 790.507,585.523C788.044,584.513 733.186,553.111 681.69,519.21C640.083,491.819 640.501,491.448 600.434,461.629C596.33,458.575 606.541,489.356 604.241,496.419C601.789,503.946 564.411,456.477 544.209,439.898C540.087,436.514 522.666,450.746 522.214,451.051C503.617,463.621 500.856,442.079 492.1,427.753C485.685,417.259 482.119,427.358 340.171,535.067C300.15,565.436 261.15,599.171 290.779,571.715C325.553,539.491 434.357,430.948 458.868,407.89C503.865,365.56 507.371,354.727 520.344,358.977C527.829,361.43 715.775,533.16 790.245,583.702Z"
          fill="url(#cmMarkMtnGrad)"
          fillRule="evenodd"
        />
      </g>
      <g transform="matrix(0.451809,0,0,0.451809,273.173684,146.688318)">
        <circle cx="512" cy="332" r="38" className="cm-brand-mark-sun" />
      </g>
      <g transform="matrix(0.523438,0,0,0.523438,236.5,122.907726)">
        <circle
          cx="512"
          cy="332"
          r="64"
          fill="none"
          className="cm-brand-mark-stroke"
          strokeWidth="12"
          vectorEffect="nonScalingStroke"
        />
      </g>
    </svg>
  );
}

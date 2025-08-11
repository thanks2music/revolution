"use client";

// component
import Image from "next/image";

const CommImage = ({
  src,
  alt,
  className = "",
}: {
  src: string;
  alt: string;
  className?: string;
}) => {
  return (
    <div className={`relative inline-block ${className}`}>
      <Image
        src={src}
        alt={alt}
        fill
        style={{
          objectFit: "cover",
        }}
      />
    </div>
  );
};

export default CommImage;
